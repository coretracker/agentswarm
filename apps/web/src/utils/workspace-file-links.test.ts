import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspaceFileLink } from "./workspace-file-links";

test("parseWorkspaceFileLink parses standard workspace links", () => {
  assert.deepEqual(parseWorkspaceFileLink("/task-workspaces/task-123/src/app.tsx#L42"), {
    taskId: "task-123",
    executionId: null,
    filePath: "src/app.tsx",
    line: 42
  });
});

test("parseWorkspaceFileLink parses ask-run workspace links", () => {
  assert.deepEqual(parseWorkspaceFileLink("/task-workspaces/.ask-runs/task-123/run-456/apps/web/page.tsx#L7"), {
    taskId: "task-123",
    executionId: "run-456",
    filePath: "apps/web/page.tsx",
    line: 7
  });
});

test("parseWorkspaceFileLink strips :line suffixes from workspace paths", () => {
  assert.deepEqual(parseWorkspaceFileLink("/task-workspaces/.ask-runs/task-123/run-456/apps/server/src/routes/tasks.ts:363"), {
    taskId: "task-123",
    executionId: "run-456",
    filePath: "apps/server/src/routes/tasks.ts",
    line: 363
  });
});

test("parseWorkspaceFileLink prefers #L line anchors over :line suffixes", () => {
  assert.deepEqual(parseWorkspaceFileLink("/task-workspaces/task-123/src/app.tsx:8#L12"), {
    taskId: "task-123",
    executionId: null,
    filePath: "src/app.tsx",
    line: 12
  });
});
