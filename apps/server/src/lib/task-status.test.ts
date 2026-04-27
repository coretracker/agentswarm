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
    assert.equal(normalizeTaskLifecycleStatus("completed", "build", true), "awaiting_review");
    assert.equal(normalizeTaskLifecycleStatus("answered", "ask", false), "open");
    assert.equal(normalizeTaskLifecycleStatus("accepted", "build", false), "open");
  });

  it("preserves explicit done state", () => {
    assert.equal(normalizeTaskLifecycleStatus("done", "build", false), "done");
  });

  it("preserves queued and active statuses", () => {
    assert.equal(normalizeTaskLifecycleStatus("build_queued", "build", false), "build_queued");
    assert.equal(normalizeTaskLifecycleStatus("asking", "ask", false), "asking");
  });
});

describe("reconcileTaskStatusWithPendingCheckpoint", () => {
  it("moves idle tasks into review when a checkpoint is pending", () => {
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("failed", true), "awaiting_review");
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("open", true), "awaiting_review");
  });

  it("returns legacy-ready states to open when no checkpoint is pending", () => {
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("accepted", false), "open");
  });

  it("preserves explicit review and done states when no checkpoint is pending", () => {
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("awaiting_review", false), "awaiting_review");
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("done", false), "done");
  });

  it("keeps archived tasks unchanged", () => {
    assert.equal(reconcileTaskStatusWithPendingCheckpoint("archived", true), "archived");
  });
});
