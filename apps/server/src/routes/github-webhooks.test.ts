import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGitHubEventDedupeKey,
  hasSupportedGitHubAction,
  isDuplicateGitHubEvent,
  isSupportedGitHubEvent,
  isValidGitHubEventPayload
} from "./github-webhooks.js";

describe("github webhook event coverage", () => {
  it("supports required event types", () => {
    assert.equal(isSupportedGitHubEvent("issues"), true);
    assert.equal(isSupportedGitHubEvent("pull_request"), true);
    assert.equal(isSupportedGitHubEvent("issue_comment"), true);
    assert.equal(isSupportedGitHubEvent("pull_request_review_comment"), true);
    assert.equal(isSupportedGitHubEvent("reaction"), true);
    assert.equal(isSupportedGitHubEvent("push"), false);
  });

  it("accepts allowed actions and rejects unsupported ones", () => {
    assert.equal(hasSupportedGitHubAction("issues", "opened"), true);
    assert.equal(hasSupportedGitHubAction("pull_request", "synchronize"), true);
    assert.equal(hasSupportedGitHubAction("issue_comment", "created"), true);
    assert.equal(hasSupportedGitHubAction("pull_request_review_comment", "edited"), true);
    assert.equal(hasSupportedGitHubAction("reaction", "deleted"), true);
    assert.equal(hasSupportedGitHubAction("issues", "transferred"), false);
  });

  it("validates minimum payload shape for supported events", () => {
    assert.equal(isValidGitHubEventPayload("issues", { action: "opened", issue: { number: 1 } }), true);
    assert.equal(isValidGitHubEventPayload("pull_request", { action: "opened", pull_request: { number: 2 } }), true);
    assert.equal(isValidGitHubEventPayload("issue_comment", { action: "created", issue: { number: 1 }, comment: { id: 99 } }), true);
    assert.equal(
      isValidGitHubEventPayload("pull_request_review_comment", {
        action: "created",
        pull_request: { number: 2 },
        comment: { id: 300 }
      }),
      true
    );
    assert.equal(isValidGitHubEventPayload("reaction", { action: "created", content: "+1" }), true);

    assert.equal(isValidGitHubEventPayload("issues", { action: "opened" }), false);
    assert.equal(isValidGitHubEventPayload("pull_request", { action: "opened" }), false);
    assert.equal(isValidGitHubEventPayload("issue_comment", { action: "created", issue: { number: 1 } }), false);
    assert.equal(
      isValidGitHubEventPayload("pull_request_review_comment", { action: "created", pull_request: { number: 2 } }),
      false
    );
    assert.equal(isValidGitHubEventPayload("reaction", { action: "created" }), false);
  });

  it("builds event-level dedupe keys and suppresses duplicates", () => {
    const payload = { action: "opened", issue: { number: 17 } } as Record<string, unknown>;
    const key = buildGitHubEventDedupeKey("repo-1", "issues", "opened", payload, null);
    assert.equal(key, "issues:repo-1:opened:17");

    const deliveryPayload = { action: "opened", issue: { number: 17 } } as Record<string, unknown>;
    assert.equal(isDuplicateGitHubEvent("repo-2", "issues", "opened", deliveryPayload, "delivery-1"), false);
    assert.equal(isDuplicateGitHubEvent("repo-2", "issues", "opened", deliveryPayload, "delivery-1"), true);

    const reviewPayload = { action: "created", pull_request: { number: 5 }, comment: { id: 808 } } as Record<string, unknown>;
    const reviewKey = buildGitHubEventDedupeKey("repo-9", "pull_request_review_comment", "created", reviewPayload, null);
    assert.equal(reviewKey, "pull_request_review_comment:repo-9:created:808");
  });
});
