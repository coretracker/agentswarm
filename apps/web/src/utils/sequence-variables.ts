import type { SequenceStep, SnippetVariable } from "@agentswarm/shared-types";

const normalizeVariable = (value: SnippetVariable): SnippetVariable => ({
  name: value.name,
  type: value.type,
  title: value.title ?? "",
  description: value.description ?? "",
  defaultValue: value.defaultValue ?? ""
});

export const mergeSnippetVariables = (input: {
  current: SnippetVariable[];
  steps: SequenceStep[];
  snippetDefinitions: Map<string, SnippetVariable[]>;
}): { next: SnippetVariable[]; conflicts: string[]; changed: boolean } => {
  const next = input.current.map((entry) => normalizeVariable(entry));
  const byName = new Map(next.map((entry, index) => [entry.name, index]));
  const conflicts = new Set<string>();

  for (const step of input.steps) {
    if (step.type !== "snippet" || !step.snippetId) {
      continue;
    }
    const variables = input.snippetDefinitions.get(step.snippetId) ?? [];
    for (const snippetVariable of variables) {
      const existingIndex = byName.get(snippetVariable.name);
      if (existingIndex === undefined) {
        byName.set(snippetVariable.name, next.length);
        next.push(normalizeVariable(snippetVariable));
        continue;
      }
      const existing = next[existingIndex]!;
      if (existing.type !== snippetVariable.type) {
        conflicts.add(snippetVariable.name);
      }
      next[existingIndex] = {
        ...existing,
        title: existing.title || snippetVariable.title || "",
        description: existing.description || snippetVariable.description || "",
        defaultValue: existing.defaultValue || snippetVariable.defaultValue || ""
      };
    }
  }

  const changed = JSON.stringify(next) !== JSON.stringify(input.current.map((entry) => normalizeVariable(entry)));
  return { next, conflicts: Array.from(conflicts), changed };
};
