import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claudeModelSupportsThinkingBudget,
  claudeThinkingBudgetTokensForProfile,
  codexReasoningEffortForProfile
} from "./provider-config.js";

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
