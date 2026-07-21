import type {
  AgentProvider,
  CreateIntegrationRuleInput,
  IntegrationRule,
  IntegrationRuleExecution,
  IntegrationRuleFilterCondition,
  IntegrationRuleFilterOp,
  IntegrationRuleFilterSource,
  IntegrationRuleMapping,
  ProviderProfile
} from "@verft/shared-types";

type YamlLine = {
  indent: number;
  text: string;
  lineNumber: number;
};

const quoteYamlString = (value: string): string => JSON.stringify(value);

const formatMaybeString = (value: string | null | undefined): string => (value == null ? "null" : quoteYamlString(value));

const ruleToInput = (rule: IntegrationRule): CreateIntegrationRuleInput => ({
  name: rule.name,
  enabled: rule.enabled,
  filter: {
    conditions: rule.filter.conditions.map((condition) => ({
      source: condition.source,
      field: condition.field,
      op: condition.op,
      ...(condition.value !== undefined ? { value: condition.value } : {})
    }))
  },
  mapping: {
    ...(rule.mapping.title !== undefined ? { title: rule.mapping.title } : {}),
    ...(rule.mapping.instructions !== undefined ? { instructions: rule.mapping.instructions } : {}),
    ...(rule.mapping.branch !== undefined ? { branch: rule.mapping.branch } : {})
  },
  execution: rule.execution
    ? {
        ...(rule.execution.provider !== undefined ? { provider: rule.execution.provider } : {}),
        ...(rule.execution.model !== undefined ? { model: rule.execution.model } : {}),
        ...(rule.execution.providerProfile !== undefined ? { providerProfile: rule.execution.providerProfile } : {})
      }
    : null,
  correlationField: rule.correlationField,
  taskOwnerUserId: rule.taskOwnerUserId
});

export const serializeIntegrationRulesToYaml = (rules: IntegrationRule[]): string => {
  const lines = ["version: 1", "rules:"];
  if (rules.length === 0) {
    return "version: 1\nrules: []\n";
  }

  for (const rule of rules.map(ruleToInput)) {
    lines.push(`  - name: ${quoteYamlString(rule.name)}`);
    lines.push(`    enabled: ${rule.enabled !== false ? "true" : "false"}`);
    lines.push("    filter:");
    lines.push("      conditions:");
    for (const condition of rule.filter.conditions) {
      lines.push(`        - source: ${condition.source}`);
      lines.push(`          field: ${quoteYamlString(condition.field)}`);
      lines.push(`          op: ${condition.op}`);
      if (condition.value !== undefined) {
        lines.push(`          value: ${quoteYamlString(condition.value)}`);
      }
    }

    lines.push("    mapping:");
    if (rule.mapping.title !== undefined) {
      lines.push(`      title: ${quoteYamlString(rule.mapping.title)}`);
    }
    if (rule.mapping.instructions !== undefined) {
      lines.push(`      instructions: ${quoteYamlString(rule.mapping.instructions)}`);
    }
    if (rule.mapping.branch !== undefined) {
      lines.push(`      branch: ${quoteYamlString(rule.mapping.branch)}`);
    }

    if (rule.execution) {
      lines.push("    execution:");
      if (rule.execution.provider !== undefined) {
        lines.push(`      provider: ${rule.execution.provider}`);
      }
      if (rule.execution.model !== undefined) {
        lines.push(`      model: ${quoteYamlString(rule.execution.model)}`);
      }
      if (rule.execution.providerProfile !== undefined) {
        lines.push(`      providerProfile: ${rule.execution.providerProfile}`);
      }
    } else {
      lines.push("    execution: null");
    }

    lines.push(`    correlationField: ${formatMaybeString(rule.correlationField)}`);
    lines.push(`    taskOwnerUserId: ${formatMaybeString(rule.taskOwnerUserId)}`);
  }

  return `${lines.join("\n")}\n`;
};

const readLines = (yaml: string): YamlLine[] =>
  yaml
    .replace(/\t/g, "  ")
    .split(/\r?\n/)
    .map((raw, index) => ({ raw, index }))
    .filter(({ raw }) => raw.trim().length > 0 && !raw.trimStart().startsWith("#"))
    .map(({ raw, index }) => ({
      indent: raw.match(/^ */)?.[0].length ?? 0,
      text: raw.trim(),
      lineNumber: index + 1
    }));

const parseScalar = (value: string): unknown => {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "[]") return [];
  if (trimmed === "{}") return {};
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"')) {
    return JSON.parse(trimmed) as string;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
};

const splitKeyValue = (text: string, lineNumber: number): [string, string | null] => {
  const index = text.indexOf(":");
  if (index < 0) {
    throw new Error(`Invalid YAML on line ${lineNumber}: expected key/value pair.`);
  }
  const key = text.slice(0, index).trim();
  if (!key) {
    throw new Error(`Invalid YAML on line ${lineNumber}: expected key.`);
  }
  const rest = text.slice(index + 1).trim();
  return [key, rest.length > 0 ? rest : null];
};

const parseBlock = (lines: YamlLine[], start: number, indent: number): { value: unknown; next: number } => {
  if (start >= lines.length || lines[start].indent < indent) {
    return { value: {}, next: start };
  }
  if (lines[start].indent !== indent) {
    throw new Error(`Invalid YAML on line ${lines[start].lineNumber}: unexpected indentation.`);
  }
  return lines[start].text.startsWith("- ") ? parseList(lines, start, indent) : parseMap(lines, start, indent);
};

const parseList = (lines: YamlLine[], start: number, indent: number): { value: unknown[]; next: number } => {
  const values: unknown[] = [];
  let index = start;

  while (index < lines.length && lines[index].indent === indent && lines[index].text.startsWith("- ")) {
    const line = lines[index];
    const rest = line.text.slice(2).trim();
    index += 1;

    if (!rest) {
      const parsed = parseBlock(lines, index, indent + 2);
      values.push(parsed.value);
      index = parsed.next;
      continue;
    }

    if (rest.includes(":")) {
      const [key, rawValue] = splitKeyValue(rest, line.lineNumber);
      const item: Record<string, unknown> = {};
      if (rawValue === null) {
        const parsed = parseBlock(lines, index, indent + 4);
        item[key] = parsed.value;
        index = parsed.next;
      } else {
        item[key] = parseScalar(rawValue);
      }
      const parsedRest = parseMapInto(lines, index, indent + 2, item);
      values.push(item);
      index = parsedRest;
      continue;
    }

    values.push(parseScalar(rest));
  }

  return { value: values, next: index };
};

const parseMapInto = (lines: YamlLine[], start: number, indent: number, target: Record<string, unknown>): number => {
  let index = start;
  while (index < lines.length && lines[index].indent === indent && !lines[index].text.startsWith("- ")) {
    const line = lines[index];
    const [key, rawValue] = splitKeyValue(line.text, line.lineNumber);
    index += 1;
    if (rawValue === null) {
      const parsed = parseBlock(lines, index, indent + 2);
      target[key] = parsed.value;
      index = parsed.next;
    } else {
      target[key] = parseScalar(rawValue);
    }
  }
  return index;
};

const parseMap = (lines: YamlLine[], start: number, indent: number): { value: Record<string, unknown>; next: number } => {
  const value: Record<string, unknown> = {};
  return { value, next: parseMapInto(lines, start, indent, value) };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readOptionalString = (record: Record<string, unknown>, key: string, context: string): string | undefined => {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${context}.${key} must be a string.`);
  }
  return value;
};

const readNullableString = (record: Record<string, unknown>, key: string, context: string): string | null | undefined => {
  const value = record[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${context}.${key} must be a string or null.`);
  }
  return value;
};

const readSource = (value: unknown, context: string): IntegrationRuleFilterSource => {
  if (value === "header" || value === "body") return value;
  throw new Error(`${context}.source must be header or body.`);
};

const readOp = (value: unknown, context: string): IntegrationRuleFilterOp => {
  if (value === "equals" || value === "contains" || value === "exists" || value === "regex") return value;
  throw new Error(`${context}.op must be equals, contains, exists, or regex.`);
};

const readProvider = (value: unknown, context: string): AgentProvider | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "codex" || value === "claude") return value;
  throw new Error(`${context}.provider must be codex or claude.`);
};

const readProviderProfile = (value: unknown, context: string): ProviderProfile | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "low" || value === "medium" || value === "high" || value === "max") return value;
  throw new Error(`${context}.providerProfile must be low, medium, high, or max.`);
};

const readConditions = (value: unknown, context: string): IntegrationRuleFilterCondition[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${context}.conditions must contain at least one condition.`);
  }
  if (value.length > 20) {
    throw new Error(`${context}.conditions cannot contain more than 20 conditions.`);
  }
  return value.map((condition, index) => {
    const conditionContext = `${context}.conditions[${index}]`;
    if (!isRecord(condition)) {
      throw new Error(`${conditionContext} must be an object.`);
    }
    const field = readOptionalString(condition, "field", conditionContext)?.trim();
    if (!field) {
      throw new Error(`${conditionContext}.field is required.`);
    }
    const parsed: IntegrationRuleFilterCondition = {
      source: readSource(condition.source, conditionContext),
      field,
      op: readOp(condition.op, conditionContext)
    };
    const value = readOptionalString(condition, "value", conditionContext);
    if (parsed.op !== "exists" && value !== undefined) {
      parsed.value = value;
    }
    return parsed;
  });
};

const readMapping = (value: unknown, context: string): IntegrationRuleMapping => {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new Error(`${context}.mapping must be an object.`);
  }
  return {
    ...(readOptionalString(value, "title", `${context}.mapping`) !== undefined
      ? { title: readOptionalString(value, "title", `${context}.mapping`) }
      : {}),
    ...(readOptionalString(value, "instructions", `${context}.mapping`) !== undefined
      ? { instructions: readOptionalString(value, "instructions", `${context}.mapping`) }
      : {}),
    ...(readOptionalString(value, "branch", `${context}.mapping`) !== undefined
      ? { branch: readOptionalString(value, "branch", `${context}.mapping`) }
      : {})
  };
};

const readExecution = (value: unknown, context: string): IntegrationRuleExecution | null => {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    throw new Error(`${context}.execution must be an object or null.`);
  }
  const execution: IntegrationRuleExecution = {};
  const provider = readProvider(value.provider, `${context}.execution`);
  const model = readOptionalString(value, "model", `${context}.execution`);
  const providerProfile = readProviderProfile(value.providerProfile, `${context}.execution`);
  if (provider !== undefined) execution.provider = provider;
  if (model !== undefined) execution.model = model;
  if (providerProfile !== undefined) execution.providerProfile = providerProfile;
  return Object.keys(execution).length > 0 ? execution : null;
};

export const parseIntegrationRulesYaml = (yaml: string): CreateIntegrationRuleInput[] => {
  const trimmed = yaml.trim();
  if (!trimmed) {
    throw new Error("YAML is empty.");
  }
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    return validateIntegrationRulesDocument(parsed);
  }
  const lines = readLines(yaml);
  const parsed = parseBlock(lines, 0, 0);
  if (parsed.next !== lines.length) {
    throw new Error(`Invalid YAML on line ${lines[parsed.next].lineNumber}.`);
  }
  return validateIntegrationRulesDocument(parsed.value);
};

const validateIntegrationRulesDocument = (value: unknown): CreateIntegrationRuleInput[] => {
  if (!isRecord(value)) {
    throw new Error("YAML root must be an object.");
  }
  if (String(value.version) !== "1") {
    throw new Error("Only integration YAML version 1 is supported.");
  }
  if (!Array.isArray(value.rules)) {
    throw new Error("YAML must include a rules list.");
  }
  if (value.rules.length > 100) {
    throw new Error("YAML cannot import more than 100 rules at once.");
  }

  return value.rules.map((rule, index) => {
    const context = `rules[${index}]`;
    if (!isRecord(rule)) {
      throw new Error(`${context} must be an object.`);
    }
    const name = readOptionalString(rule, "name", context)?.trim();
    if (!name) {
      throw new Error(`${context}.name is required.`);
    }
    if (name.length > 200) {
      throw new Error(`${context}.name cannot exceed 200 characters.`);
    }
    if (!isRecord(rule.filter)) {
      throw new Error(`${context}.filter must be an object.`);
    }
    const enabled = rule.enabled;
    if (enabled !== undefined && typeof enabled !== "boolean") {
      throw new Error(`${context}.enabled must be true or false.`);
    }
    return {
      name,
      enabled: enabled === undefined ? true : enabled,
      filter: { conditions: readConditions(rule.filter.conditions, `${context}.filter`) },
      mapping: readMapping(rule.mapping, context),
      execution: readExecution(rule.execution, context),
      correlationField: readNullableString(rule, "correlationField", context) ?? null,
      taskOwnerUserId: readNullableString(rule, "taskOwnerUserId", context) ?? null
    };
  });
};
