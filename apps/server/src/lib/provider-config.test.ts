import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claudeModelSupportsThinkingBudget,
  claudeThinkingBudgetTokensForProfile,
  codexReasoningEffortForProfile
} from "./provider-config.js";
import { AGENT_RUNTIME_IMAGE } from "../config/env.js";
import { getProviderRuntimeDefinition } from "../providers/runtime-definitions.js";

describe("codexReasoningEffortForProfile", () => {
  it("maps max to high for Codex", () => {
    assert.equal(codexReasoningEffortForProfile("max"), "high");
  });
});

describe("claudeModelSupportsThinkingBudget", () => {
  it("accepts Sonnet and Opus 4 families", () => {
    assert.equal(claudeModelSupportsThinkingBudget("claude-sonnet-4-5"), true);
    assert.equal(claudeModelSupportsThinkingBudget("claude-opus-4-5"), true);
    assert.equal(claudeModelSupportsThinkingBudget("claude-3-7-sonnet"), true);
  });

  it("rejects models without extended thinking support", () => {
    assert.equal(claudeModelSupportsThinkingBudget("claude-haiku-3-5"), false);
    assert.equal(claudeModelSupportsThinkingBudget(""), false);
    assert.equal(claudeModelSupportsThinkingBudget(null), false);
  });
});

describe("claudeThinkingBudgetTokensForProfile", () => {
  it("maps effort profiles to thinking budgets", () => {
    assert.equal(claudeThinkingBudgetTokensForProfile("low"), 1024);
    assert.equal(claudeThinkingBudgetTokensForProfile("medium"), 4096);
    assert.equal(claudeThinkingBudgetTokensForProfile("high"), 16384);
    assert.equal(claudeThinkingBudgetTokensForProfile("max"), undefined);
  });
});

describe("provider runtime definitions", () => {
  it("use the unified toolbox image with provider-specific runner commands", () => {
    const codex = getProviderRuntimeDefinition("codex");
    const claude = getProviderRuntimeDefinition("claude");

    assert.equal(codex.image, AGENT_RUNTIME_IMAGE);
    assert.equal(claude.image, AGENT_RUNTIME_IMAGE);
    assert.equal(codex.context.endsWith("/agent-runtime"), true);
    assert.equal(claude.context, codex.context);
    assert.deepEqual(codex.command, ["node", "/usr/local/bin/run-task-codex.mjs"]);
    assert.deepEqual(claude.command, ["node", "/usr/local/bin/run-task-claude.mjs"]);
  });
});
