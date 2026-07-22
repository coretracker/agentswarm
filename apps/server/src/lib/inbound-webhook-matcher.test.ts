import assert from "node:assert/strict";
import { test } from "node:test";
import type { IntegrationRule } from "@verft/shared-types";
import {
  findMatchingRule,
  interpolateTemplate,
  resolveCorrelationValue
} from "./inbound-webhook-matcher.js";

const createRule = (overrides: Partial<IntegrationRule>): IntegrationRule => ({
  id: "rule-1",
  repositoryId: "repo-1",
  name: "Rule",
  enabled: true,
  filter: { conditions: [] },
  mapping: {},
  execution: null,
  correlationField: null,
  taskOwnerUserId: null,
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
  ...overrides
});

test("matches popular webhook headers case-insensitively", () => {
  const rule = createRule({
    filter: { conditions: [{ source: "header", field: "X-GitHub-Event", op: "equals", value: "issue_comment" }] }
  });

  assert.equal(findMatchingRule([rule], { "x-github-event": "issue_comment" }, {})?.id, "rule-1");
});

test("matches nested body fields used by Jira and Linear payloads", () => {
  const rule = createRule({
    filter: {
      conditions: [
        { source: "body", field: "webhookEvent", op: "equals", value: "jira:issue_updated" },
        { source: "body", field: "issue.fields.summary", op: "contains", value: "Checkout" },
        { source: "body", field: "data.issue.id", op: "exists" }
      ]
    }
  });

  const body = {
    webhookEvent: "jira:issue_updated",
    issue: { fields: { summary: "Checkout bug" } },
    data: { issue: { id: "LIN-123" } }
  };

  assert.equal(findMatchingRule([rule], {}, body)?.id, "rule-1");
});

test("invalid regex conditions fail closed", () => {
  const rule = createRule({
    filter: { conditions: [{ source: "body", field: "action", op: "regex", value: "[" }] }
  });

  assert.equal(findMatchingRule([rule], {}, { action: "opened" }), null);
});

test("interpolates and correlates header/body values", () => {
  const headers = { "x-linear-delivery": "delivery-1" };
  const body = { issue: { key: "WEB-42", summary: "Fix webhook" } };

  assert.equal(
    interpolateTemplate("{{body.issue.key}} {{body.issue.summary}} {{header.X-Linear-Delivery}}", headers, body),
    "WEB-42 Fix webhook delivery-1"
  );
  assert.equal(resolveCorrelationValue("body.issue.key", headers, body), "WEB-42");
  assert.equal(resolveCorrelationValue("header.X-Linear-Delivery", headers, body), "delivery-1");
});

test("interpolates integration rule helper expressions", () => {
  const body = { title: "Fix webhook title that is too long" };

  assert.equal(
    interpolateTemplate("{{slugify(body.title)}} {{truncate(body.title, 17)}} {{unknown(body.title)}}", {}, body),
    "fix-webhook-title-that-is-too-long Fix webhook title {{unknown(body.title)}}"
  );
});
