import { strict as assert } from "node:assert";
import { after, describe, test } from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeSafeWorkspaceRelativePath, resolveSafeWorkspaceFilePath } from "./safe-workspace-file.js";

describe("resolveSafeWorkspaceFilePath", () => {
  const base = mkdtempSync(path.join(tmpdir(), "agentswarm-ws-"));

  after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  test("resolves a normal relative path", () => {
    const ws = path.join(base, "task1");
    const filePath = path.join(ws, "src", "foo.ts");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "");
    const got = resolveSafeWorkspaceFilePath(ws, "src/foo.ts");
    assert.equal(got, realpathSync.native(filePath));
  });

  test("rejects empty path", () => {
    const ws = path.join(base, "e");
    mkdirSync(ws, { recursive: true });
    assert.equal(resolveSafeWorkspaceFilePath(ws, ""), null);
    assert.equal(resolveSafeWorkspaceFilePath(ws, "   "), null);
  });

  test("normalizes separators while rejecting traversal", () => {
    assert.equal(normalizeSafeWorkspaceRelativePath("dir\\\\file.png"), "dir/file.png");
    assert.equal(normalizeSafeWorkspaceRelativePath("../escape"), null);
    assert.equal(normalizeSafeWorkspaceRelativePath("bad:name.png"), null);
  });

  test("rejects absolute user path", () => {
    const ws = path.join(base, "abs");
    mkdirSync(ws, { recursive: true });
    assert.equal(resolveSafeWorkspaceFilePath(ws, "/etc/passwd"), null);
  });

  test("rejects parent traversal in segments", () => {
    const ws = path.join(base, "dot");
    mkdirSync(ws, { recursive: true });
    assert.equal(resolveSafeWorkspaceFilePath(ws, "../escape"), null);
    assert.equal(resolveSafeWorkspaceFilePath(ws, "a/../../escape"), null);
  });

  test("rejects symlink that escapes workspace", () => {
    const ws = path.join(base, "symws");
    const outside = path.join(base, "outside");
    mkdirSync(ws, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "secret.txt"), "x");
    symlinkSync(outside, path.join(ws, "linkout"));
    assert.equal(resolveSafeWorkspaceFilePath(ws, "linkout/secret.txt"), null);
  });
});
