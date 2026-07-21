import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildVerftBaseMountArgsForSource,
  evaluateVerftBaseStateSource,
  VERFT_BASE_CONTAINER_ROOT
} from "./verft-base-mounts.js";

describe("evaluateVerftBaseStateSource", () => {
  it("falls back to the verft base volume when no host state is configured", () => {
    const source = evaluateVerftBaseStateSource({ volume: "verft_base" });

    assert.deepEqual(source, { type: "volume", name: "verft_base" });
    assert.deepEqual(buildVerftBaseMountArgsForSource(source), ["-v", `verft_base:${VERFT_BASE_CONTAINER_ROOT}:ro`]);
    assert.deepEqual(buildVerftBaseMountArgsForSource(source, "rw"), [
      "-v",
      `verft_base:${VERFT_BASE_CONTAINER_ROOT}:rw`
    ]);
  });

  it("maps a host home root to provider state directories and Claude sidecar config when present", () => {
    const source = evaluateVerftBaseStateSource({
      volume: "verft_base",
      hostRoot: "/Users/dev",
      pathExists: (candidate) => candidate === "/Users/dev/.claude.json"
    });

    assert.deepEqual(source, {
      type: "host",
      root: "/Users/dev",
      volume: "verft_base",
      codexPath: "/Users/dev/.codex",
      claudePath: "/Users/dev/.claude",
      claudeConfigPath: "/Users/dev/.claude.json"
    });
    assert.deepEqual(buildVerftBaseMountArgsForSource(source), [
      "-v",
      `verft_base:${VERFT_BASE_CONTAINER_ROOT}:ro`,
      "-v",
      `/Users/dev/.codex:${VERFT_BASE_CONTAINER_ROOT}/codex:ro`,
      "-v",
      `/Users/dev/.claude:${VERFT_BASE_CONTAINER_ROOT}/claude:ro`,
      "-v",
      `/Users/dev/.claude.json:${VERFT_BASE_CONTAINER_ROOT}/claude/.claude.json:ro`
    ]);
    assert.deepEqual(buildVerftBaseMountArgsForSource(source, "rw"), [
      "-v",
      `verft_base:${VERFT_BASE_CONTAINER_ROOT}:rw`,
      "-v",
      `/Users/dev/.codex:${VERFT_BASE_CONTAINER_ROOT}/codex:rw`,
      "-v",
      `/Users/dev/.claude:${VERFT_BASE_CONTAINER_ROOT}/claude:rw`,
      "-v",
      `/Users/dev/.claude.json:${VERFT_BASE_CONTAINER_ROOT}/claude/.claude.json:rw`
    ]);
  });

  it("allows a single explicit provider path without forcing the other provider to host state", () => {
    const source = evaluateVerftBaseStateSource({
      volume: "verft_base",
      codexHostPath: "/state/codex"
    });

    assert.deepEqual(source, {
      type: "host",
      root: "",
      volume: "verft_base",
      codexPath: "/state/codex",
      claudePath: null,
      claudeConfigPath: null
    });
    assert.deepEqual(buildVerftBaseMountArgsForSource(source), [
      "-v",
      `verft_base:${VERFT_BASE_CONTAINER_ROOT}:ro`,
      "-v",
      `/state/codex:${VERFT_BASE_CONTAINER_ROOT}/codex:ro`
    ]);
  });

  it("uses explicit Claude sidecar config override", () => {
    const source = evaluateVerftBaseStateSource({
      volume: "verft_base",
      claudeHostPath: "/state/claude",
      claudeConfigHostPath: "/state/claude-home.json",
      pathExists: (candidate) => candidate === "/state/claude-home.json"
    });

    assert.deepEqual(source, {
      type: "host",
      root: "",
      volume: "verft_base",
      codexPath: null,
      claudePath: "/state/claude",
      claudeConfigPath: "/state/claude-home.json"
    });
    assert.deepEqual(buildVerftBaseMountArgsForSource(source), [
      "-v",
      `verft_base:${VERFT_BASE_CONTAINER_ROOT}:ro`,
      "-v",
      `/state/claude:${VERFT_BASE_CONTAINER_ROOT}/claude:ro`,
      "-v",
      `/state/claude-home.json:${VERFT_BASE_CONTAINER_ROOT}/claude/.claude.json:ro`
    ]);
  });

  it("does not mount missing Claude sidecar config", () => {
    const source = evaluateVerftBaseStateSource({
      volume: "verft_base",
      claudeHostPath: "/state/claude",
      pathExists: () => false
    });

    assert.equal(source.type, "host");
    assert.equal(source.claudeConfigPath, null);
    assert.deepEqual(buildVerftBaseMountArgsForSource(source), [
      "-v",
      `verft_base:${VERFT_BASE_CONTAINER_ROOT}:ro`,
      "-v",
      `/state/claude:${VERFT_BASE_CONTAINER_ROOT}/claude:ro`
    ]);
  });
});
