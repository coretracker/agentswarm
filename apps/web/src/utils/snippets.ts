import type { SnippetVariable } from "@agentswarm/shared-types";

const SNIPPET_PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export const insertSnippetContent = (current: string | null | undefined, snippet: string | null | undefined): string => {
  const snippetText = snippet?.trim() ?? "";
  if (!snippetText) {
    return current ?? "";
  }

  const currentText = current ?? "";
  if (currentText.trim().length === 0) {
    return snippetText;
  }

  return `${currentText.trimEnd()}\n\n${snippetText}`;
};

export const applySnippetVariables = (
  content: string | null | undefined,
  variables: SnippetVariable[] | null | undefined,
  values: Record<string, string>
): string => {
  const snippetText = content ?? "";
  const allowed = new Set((variables ?? []).map((entry) => entry.name));
  return snippetText.replace(SNIPPET_PLACEHOLDER_PATTERN, (_match, name: string) => {
    if (!allowed.has(name)) {
      return `{{${name}}}`;
    }
    return values[name] ?? "";
  });
};
