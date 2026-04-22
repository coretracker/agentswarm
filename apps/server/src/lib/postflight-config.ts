import type { AgentProvider, Task } from "@agentswarm/shared-types";
import { z } from "zod";

type ParsedYamlValue = string | number | boolean | ParsedYamlObject | ParsedYamlValue[];

interface ParsedYamlObject {
  [key: string]: ParsedYamlValue;
}

interface ParsedYamlLine {
  indent: number;
  content: string;
  lineNumber: number;
}

const postflightTaskTypeSchema = z.enum(["build", "ask"]);
const postflightProviderSchema = z.enum(["codex", "claude"]);

const postflightConfigSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean().default(true),
  when: z
    .object({
      task_types: z.array(postflightTaskTypeSchema).optional(),
      providers: z.array(postflightProviderSchema).optional()
    })
    .default({}),
  runner: z.object({
    image: z.string().trim().min(1),
    timeout_seconds: z.coerce.number().int().positive().default(1800)
  }),
  steps: z.array(z.object({ run: z.string().trim().min(1) })).min(1),
  on_failure: z.enum(["fail_task", "ignore"]).default("fail_task")
});

export type PostflightConfig = z.infer<typeof postflightConfigSchema>;

function stripInlineComment(line: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "#" && (index === 0 || /\s/.test(line[index - 1] ?? ""))) {
      return line.slice(0, index).trimEnd();
    }
  }

  return line.trimEnd();
}

function tokenizeYaml(raw: string): ParsedYamlLine[] {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line, index) => {
      if (line.includes("\t")) {
        throw new Error(`Tabs are not supported in postflight.yml (line ${index + 1}).`);
      }

      const withoutComments = stripInlineComment(line);
      if (withoutComments.trim().length === 0) {
        return [];
      }

      const indent = withoutComments.match(/^ */)?.[0].length ?? 0;
      if (indent % 2 !== 0) {
        throw new Error(`Indentation must use multiples of 2 spaces (line ${index + 1}).`);
      }

      return [
        {
          indent,
          content: withoutComments.trim(),
          lineNumber: index + 1
        }
      ];
    });
}

function splitKeyValue(content: string, lineNumber: number): { key: string; value: string } {
  const separatorIndex = content.indexOf(":");
  if (separatorIndex <= 0) {
    throw new Error(`Expected a key/value entry on line ${lineNumber}.`);
  }

  return {
    key: content.slice(0, separatorIndex).trim(),
    value: content.slice(separatorIndex + 1).trim()
  };
}

function parseQuotedString(value: string, lineNumber: number): string {
  if (value.length < 2) {
    throw new Error(`Invalid quoted string on line ${lineNumber}.`);
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      throw new Error(`Invalid double-quoted string on line ${lineNumber}.`);
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }

  throw new Error(`Invalid quoted string on line ${lineNumber}.`);
}

function parseInlineArray(value: string, lineNumber: number): ParsedYamlValue[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error(`Invalid inline array on line ${lineNumber}.`);
  }

  const body = trimmed.slice(1, -1).trim();
  if (!body) {
    return [];
  }

  const items: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      current += char;
      quote = char;
      continue;
    }

    if (char === ",") {
      items.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error(`Unterminated string in inline array on line ${lineNumber}.`);
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items.map((item) => parseYamlScalar(item, lineNumber));
}

function parseYamlScalar(value: string, lineNumber: number): ParsedYamlValue {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return parseInlineArray(trimmed, lineNumber);
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return parseQuotedString(trimmed, lineNumber);
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  return trimmed;
}

function parseYamlList(
  lines: ParsedYamlLine[],
  startIndex: number,
  indent: number
): { value: ParsedYamlValue[]; nextIndex: number } {
  const items: ParsedYamlValue[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) {
      break;
    }
    if (line.indent !== indent || !line.content.startsWith("- ")) {
      throw new Error(`Expected a list item on line ${line.lineNumber}.`);
    }

    const itemContent = line.content.slice(2).trim();
    if (!itemContent) {
      throw new Error(`Empty list items are not supported in postflight.yml (line ${line.lineNumber}).`);
    }

    if (itemContent.includes(":")) {
      const { key, value } = splitKeyValue(itemContent, line.lineNumber);
      const item: ParsedYamlObject = {
        [key]: value ? parseYamlScalar(value, line.lineNumber) : ""
      };
      index += 1;

      if (index < lines.length && lines[index]!.indent > indent) {
        const nestedIndent = lines[index]!.indent;
        if (lines[index]!.content.startsWith("- ")) {
          throw new Error(`Nested lists inside list items are not supported (line ${lines[index]!.lineNumber}).`);
        }
        const nested = parseYamlMap(lines, index, nestedIndent);
        Object.assign(item, nested.value);
        index = nested.nextIndex;
      }

      items.push(item);
      continue;
    }

    items.push(parseYamlScalar(itemContent, line.lineNumber));
    index += 1;
  }

  return { value: items, nextIndex: index };
}

function parseYamlMap(
  lines: ParsedYamlLine[],
  startIndex: number,
  indent: number
): { value: ParsedYamlObject; nextIndex: number } {
  const value: ParsedYamlObject = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) {
      break;
    }
    if (line.indent !== indent) {
      throw new Error(`Unexpected indentation on line ${line.lineNumber}.`);
    }
    if (line.content.startsWith("- ")) {
      throw new Error(`Unexpected list item on line ${line.lineNumber}.`);
    }

    const entry = splitKeyValue(line.content, line.lineNumber);
    if (entry.value) {
      value[entry.key] = parseYamlScalar(entry.value, line.lineNumber);
      index += 1;
      continue;
    }

    index += 1;
    if (index >= lines.length || lines[index]!.indent <= indent) {
      throw new Error(`Expected nested content for "${entry.key}" on line ${line.lineNumber}.`);
    }

    const nestedIndent = lines[index]!.indent;
    if (lines[index]!.content.startsWith("- ")) {
      const nested = parseYamlList(lines, index, nestedIndent);
      value[entry.key] = nested.value;
      index = nested.nextIndex;
      continue;
    }

    const nested = parseYamlMap(lines, index, nestedIndent);
    value[entry.key] = nested.value;
    index = nested.nextIndex;
  }

  return { value, nextIndex: index };
}

function parseLimitedYaml(raw: string): ParsedYamlObject {
  const lines = tokenizeYaml(raw);
  if (lines.length === 0) {
    throw new Error("postflight.yml is empty.");
  }
  if (lines[0]!.indent !== 0) {
    throw new Error("Top-level keys in postflight.yml must start at column 1.");
  }

  const parsed = parseYamlMap(lines, 0, 0);
  if (parsed.nextIndex !== lines.length) {
    const next = lines[parsed.nextIndex]!;
    throw new Error(`Could not parse postflight.yml near line ${next.lineNumber}.`);
  }

  return parsed.value;
}

export function parsePostflightConfig(raw: string): PostflightConfig {
  const parsed = parseLimitedYaml(raw);
  return postflightConfigSchema.parse(parsed);
}

export function postflightAppliesToTask(
  config: PostflightConfig,
  input: Pick<Task, "taskType" | "provider"> | { taskType: Task["taskType"]; provider: AgentProvider }
): boolean {
  if (!config.enabled) {
    return false;
  }

  const matchesTaskType =
    !config.when.task_types || config.when.task_types.length === 0 || config.when.task_types.includes(input.taskType);
  const matchesProvider =
    !config.when.providers || config.when.providers.length === 0 || config.when.providers.includes(input.provider);

  return matchesTaskType && matchesProvider;
}
