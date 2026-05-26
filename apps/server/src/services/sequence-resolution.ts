import type { Sequence, SnippetVariable } from "@agentswarm/shared-types";
import type { SnippetStore } from "./snippet-store.js";

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

const normalizeVariableValue = (variable: SnippetVariable, value: string): string =>
  variable.type === "text" ? (value.split(/\r?\n/u)[0] ?? "") : value;

const collectPlaceholders = (value: string): string[] => {
  const names = new Set<string>();
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]?.trim();
    if (name) {
      names.add(name);
    }
  }
  return Array.from(names);
};

export class SequenceValidationError extends Error {}

export const resolveSequenceStepPrompts = async (input: {
  sequence: Sequence;
  snippetStore: SnippetStore;
  variables?: Record<string, string>;
}): Promise<string[]> => {
  const variablesByName = new Map(input.sequence.variables.map((variable) => [variable.name, variable]));
  const providedValues = input.variables ?? {};
  const resolvedValues = new Map<string, string>();
  for (const variable of input.sequence.variables) {
    const provided = typeof providedValues[variable.name] === "string" ? providedValues[variable.name]! : "";
    const selected = provided.length > 0 ? provided : variable.defaultValue ?? "";
    resolvedValues.set(variable.name, normalizeVariableValue(variable, selected));
  }

  const stepPrompts: string[] = [];
  for (const [index, step] of input.sequence.steps.entries()) {
    const stepLabel = `step ${index + 1}`;
    let template = step.prompt.trim();
    if (step.type === "snippet") {
      if (!step.snippetId) {
        throw new SequenceValidationError(`Sequence ${stepLabel} is missing its snippet reference.`);
      }
      const snippet = await input.snippetStore.getSnippet(step.snippetId);
      if (!snippet) {
        throw new SequenceValidationError(`Sequence ${stepLabel} references a deleted snippet (${step.snippetId}).`);
      }
      template = snippet.content.trim();
    }

    if (template.length === 0) {
      throw new SequenceValidationError(`Sequence ${stepLabel} has empty content.`);
    }

    const placeholders = collectPlaceholders(template);
    for (const name of placeholders) {
      const variable = variablesByName.get(name);
      if (!variable) {
        throw new SequenceValidationError(`Sequence ${stepLabel} contains an invalid variable placeholder: {{${name}}}.`);
      }
      const provided = typeof providedValues[name] === "string" ? providedValues[name]! : "";
      const defaultValue = variable.defaultValue ?? "";
      if (provided.length === 0 && defaultValue.length === 0) {
        throw new SequenceValidationError(`Missing required variable "${name}" for sequence ${stepLabel}.`);
      }
    }

    const rendered = template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => resolvedValues.get(name) ?? `{{${name}}}`);
    if (rendered.trim().length === 0) {
      throw new SequenceValidationError(`Sequence ${stepLabel} resolved to empty content.`);
    }
    stepPrompts.push(rendered.trim());
  }

  return stepPrompts;
};
