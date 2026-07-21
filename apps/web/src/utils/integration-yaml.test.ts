import assert from "node:assert/strict";
import { test } from "node:test";
import type { IntegrationRule } from "@verft/shared-types";
import { parseIntegrationRulesYaml, serializeIntegrationRulesToYaml } from "./integration-yaml";

const rule: IntegrationRule = {
  id: "rule-1",
  repositoryId: "repo-1",
  name: "GitHub bot mention",
  enabled: true,
  filter: {
    conditions: [
      { source: "header", field: "x-github-event", op: "equals", value: "issue_comment" },
      {
        source: "body",
        field: "comment.body",
        op: "regex",
        value: "(^|[^A-Za-z0-9_])@verftbot(?=$|[^A-Za-z0-9_])"
      }
    ]
  },
  mapping: {
    title: "{{body.issue.title}}",
    instructions: "{{body.comment.body}}\n\nURL: {{body.comment.html_url}}",
    branch: "{{body.issue.number}}"
  },
  execution: { provider: "codex", model: "gpt-5.5", providerProfile: "high" },
  correlationField: "body.issue.id",
  taskOwnerUserId: "user-1",
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z"
};

test("serializes and parses integration rules as YAML", () => {
  const yaml = serializeIntegrationRulesToYaml([rule]);
  const [parsed] = parseIntegrationRulesYaml(yaml);

  assert.equal(parsed.name, "GitHub bot mention");
  assert.equal(parsed.filter.conditions[1].value, "(^|[^A-Za-z0-9_])@verftbot(?=$|[^A-Za-z0-9_])");
  assert.equal(parsed.mapping.instructions, "{{body.comment.body}}\n\nURL: {{body.comment.html_url}}");
  assert.deepEqual(parsed.execution, { provider: "codex", model: "gpt-5.5", providerProfile: "high" });
  assert.equal(parsed.correlationField, "body.issue.id");
  assert.equal(parsed.taskOwnerUserId, "user-1");
});

test("parses minimal edited YAML", () => {
  const [parsed] = parseIntegrationRulesYaml(`
version: 1
rules:
  - name: Linear issue update
    filter:
      conditions:
        - source: body
          field: event.type
          op: equals
          value: Issue
    mapping:
      title: data.issue.title
    execution: null
`);

  assert.equal(parsed.enabled, true);
  assert.equal(parsed.name, "Linear issue update");
  assert.deepEqual(parsed.filter.conditions, [{ source: "body", field: "event.type", op: "equals", value: "Issue" }]);
  assert.deepEqual(parsed.mapping, { title: "data.issue.title" });
  assert.equal(parsed.execution, null);
});

test("round trips an empty rules export", () => {
  assert.deepEqual(parseIntegrationRulesYaml(serializeIntegrationRulesToYaml([])), []);
});

test("rejects invalid integration rule operators", () => {
  assert.throws(
    () =>
      parseIntegrationRulesYaml(`
version: 1
rules:
  - name: Broken
    filter:
      conditions:
        - source: body
          field: action
          op: startsWith
`),
    /op must be/
  );
});
