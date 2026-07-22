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

const stringifyTemplateValue = (value: unknown): string =>
  value !== undefined && value !== null ? String(value) : "";

const slugify = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const truncate = (value: string, maxLength: number): string =>
  value.slice(0, Math.max(0, maxLength));

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

const resolveTemplatePath = (
  path: string,
  headers: Record<string, string>,
  body: unknown
): string | null => {
  if (path.startsWith("body.")) {
    return stringifyTemplateValue(getNestedValue(body, path.slice(5)));
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
  return null;
};

const resolveTemplateExpression = (
  expression: string,
  headers: Record<string, string>,
  body: unknown
): string | null => {
  const directValue = resolveTemplatePath(expression, headers, body);
  if (directValue !== null) {
    return directValue;
  }

  const slugifyMatch = expression.match(/^slugify\((body\.[^)]+|header\.[^)]+)\)$/);
  if (slugifyMatch?.[1]) {
    return slugify(resolveTemplatePath(slugifyMatch[1], headers, body) ?? "");
  }

  const truncateMatch = expression.match(/^truncate\((body\.[^)]+|header\.[^)]+),\s*(\d+)\)$/);
  if (truncateMatch?.[1] && truncateMatch[2]) {
    return truncate(resolveTemplatePath(truncateMatch[1], headers, body) ?? "", Number(truncateMatch[2]));
  }

  return null;
};

export const interpolateTemplate = (
  template: string,
  headers: Record<string, string>,
  body: unknown
): string =>
  template.replace(/\{\{([^}]+)\}\}/g, (match, rawExpression: string) => {
    const resolved = resolveTemplateExpression(rawExpression.trim(), headers, body);
    return resolved ?? match;
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
