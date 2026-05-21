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
  const variablesByName = new Map((variables ?? []).map((entry) => [entry.name, entry]));
  return snippetText.replace(SNIPPET_PLACEHOLDER_PATTERN, (_match, name: string) => {
    const variable = variablesByName.get(name);
    if (!variable) {
      return `{{${name}}}`;
    }
    const value = values[name];
    const selected = typeof value === "string" && value.length > 0 ? value : variable.defaultValue ?? "";
    if (variable.type === "text") {
      return selected.split(/\r?\n/u)[0] ?? "";
    }
    return selected;
  });
};
