import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeTaskLifecycleStatus,
  reconcileTaskStatusWithPendingCheckpoint,
  resolveTaskReadyStatus
} from "./task-status.js";

describe("resolveTaskReadyStatus", () => {
  it("returns open when no checkpoint is pending", () => {
    assert.equal(resolveTaskReadyStatus(false), "open");
  });

  it("returns awaiting_review when a checkpoint is pending", () => {
    assert.equal(resolveTaskReadyStatus(true), "awaiting_review");
  });
});

describe("normalizeTaskLifecycleStatus", () => {
  it("maps legacy successful statuses into the new ready states", () => {
    assert.equal(normalizeTaskLifecycleStatus("completed", "build", true), "open");
    assert.equal(normalizeTaskLifecycleStatus("answered", "ask", false), "open");
    assert.equal(normalizeTaskLifecycleStatus("accepted", "build", false), "open");
  });

  it("preserves explicit done state", () => {
    assert.equal(normalizeTaskLifecycleStatus("done", "build", false), "done");
  });

  it("preserves explicit in_review state", () => {
    assert.equal(normalizeTaskLifecycleStatus("in_review", "build", false), "in_review");
  });

  it("maps queued and active execution statuses back to open workflow state", () => {
    assert.equal(normalizeTaskLifecycleStatus("build_queued", "build", false), "open");
    assert.equal(normalizeTaskLifecycleStatus("asking", "ask", false), "open");
  });

  it("preserves draft state", () => {
    assert.equal(normalizeTaskLifecycleStatus("draft", "build", false), "draft");
  });
});

describe("reconcileTaskStatusWithPendingCheckpoint", () => {
  it("does not move workflow state when a checkpoint is pending", () => {
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("failed", true), "open");
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("open", true), "open");
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("in_review", true), "in_review");
  });

  it("returns legacy-ready states to open when no checkpoint is pending", () => {
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("accepted", false), "open");
  });

  it("preserves explicit in_review and done states when no checkpoint is pending", () => {
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("in_review", false), "in_review");
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("done", false), "done");
  });

  it("returns awaiting_review to open when no checkpoint is pending", () => {
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("awaiting_review", false), "open");
  });

  it("keeps archived tasks unchanged", () => {
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("archived", true), "archived");
  });

  it("keeps draft tasks unchanged", () => {
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("draft", true), "draft");
  });
});
