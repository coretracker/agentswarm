import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHostProviderStateMountArgsForPaths, resolveHostProviderStatePaths } from "./verft-base-mounts.js";

describe("resolveHostProviderStatePaths", () => {
  it("derives provider paths from the host root without filesystem checks", () => {
    assert.deepEqual(resolveHostProviderStatePaths({ hostRoot: "/Users/dev" }), {
      codexPath: "/Users/dev/.codex",
      claudePath: "/Users/dev/.claude",
      claudeConfigPath: "/Users/dev/.claude.json"
    });
  });

  it("allows explicit path overrides independently", () => {
    assert.deepEqual(
      resolveHostProviderStatePaths({
        hostRoot: "/Users/dev",
        codexHostPath: "/state/codex",
        claudeConfigHostPath: "/state/claude.json"
      }),
      {
        codexPath: "/state/codex",
        claudePath: "/Users/dev/.claude",
        claudeConfigPath: "/state/claude.json"
      }
    );
  });
});

describe("buildHostProviderStateMountArgsForPaths", () => {
  it("mounts host provider state directly into the agent home read-only", () => {
    assert.deepEqual(
      buildHostProviderStateMountArgsForPaths({
        codexPath: "/Users/dev/.codex",
        claudePath: "/Users/dev/.claude",
        claudeConfigPath: "/Users/dev/.claude.json"
      }),
      [
        "--mount",
        "type=bind,src=/Users/dev/.codex,dst=/home/agent/.codex,readonly",
        "--mount",
        "type=bind,src=/Users/dev/.claude,dst=/home/agent/.claude,readonly",
        "--mount",
        "type=bind,src=/Users/dev/.claude.json,dst=/home/agent/.claude.json,readonly"
      ]
    );
  });
});
