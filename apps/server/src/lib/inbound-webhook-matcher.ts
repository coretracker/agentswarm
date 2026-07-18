import type { IntegrationRule, IntegrationRuleFilterCondition } from "@verft/shared-types";

const MAX_DEPTH = 10;

export const getNestedValue = (obj: unknown, dotPath: string): unknown => {
  const parts = dotPath.split(".");
  if (parts.length > MAX_DEPTH) {
    return undefined;
  }
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const resolveFieldValue = (
  condition: IntegrationRuleFilterCondition,
  headers: Record<string, string>,
  body: unknown
): unknown => {
  if (condition.source === "header") {
    const lowerField = condition.field.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerField) {
        return value;
      }
    }
    return undefined;
  }
  return getNestedValue(body, condition.field);
};

export const evaluateCondition = (
  condition: IntegrationRuleFilterCondition,
  headers: Record<string, string>,
  body: unknown
): boolean => {
  const value = resolveFieldValue(condition, headers, body);

  switch (condition.op) {
    case "exists":
      return value !== undefined && value !== null;
    case "equals":
      return String(value ?? "") === (condition.value ?? "");
    case "contains":
      return String(value ?? "").includes(condition.value ?? "");
    case "regex": {
      try {
        return new RegExp(condition.value ?? "").test(String(value ?? ""));
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
};

export const matchRule = (
  rule: IntegrationRule,
  headers: Record<string, string>,
  body: unknown
): boolean => {
  const conditions = rule.filter?.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return false;
  }
  return conditions.every((condition) => evaluateCondition(condition, headers, body));
};

export const findMatchingRule = (
  rules: IntegrationRule[],
  headers: Record<string, string>,
  body: unknown
): IntegrationRule | null => {
  for (const rule of rules) {
    if (rule.enabled && matchRule(rule, headers, body)) {
      return rule;
    }
  }
  return null;
};

export const interpolateTemplate = (
  template: string,
  headers: Record<string, string>,
  body: unknown
): string =>
  template.replace(/\{\{(body\.[^}]+|header\.[^}]+)\}\}/g, (_match, path: string) => {
    if (path.startsWith("body.")) {
      const value = getNestedValue(body, path.slice(5));
      return value !== undefined && value !== null ? String(value) : "";
    }
    if (path.startsWith("header.")) {
      const headerName = path.slice(7);
      const lowerName = headerName.toLowerCase();
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lowerName) {
          return value;
        }
      }
      return "";
    }
    return "";
  });

export const resolveCorrelationValue = (
  correlationField: string | null,
  headers: Record<string, string>,
  body: unknown
): string | null => {
  if (!correlationField?.trim()) {
    return null;
  }

  const field = correlationField.trim();
  let value: unknown;
  if (field.startsWith("header.")) {
    const headerName = field.slice(7);
    const lowerName = headerName.toLowerCase();
    for (const [key, val] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName) {
        value = val;
        break;
      }
    }
  } else if (field.startsWith("body.")) {
    value = getNestedValue(body, field.slice(5));
  } else {
    value = getNestedValue(body, field);
  }

  return value !== undefined && value !== null ? String(value) : null;
};
