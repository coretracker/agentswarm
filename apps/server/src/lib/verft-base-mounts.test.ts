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
    assert.deepEqual(buildVerftBaseMountArgsForSource(source), ["-v", `verft_base:${VERFT_BASE_CONTAINER_ROOT}:rw`]);
  });

  it("maps a host home root to the provider state directories", () => {
    const source = evaluateVerftBaseStateSource({ volume: "verft_base", hostRoot: "/Users/dev" });

    assert.deepEqual(source, {
      type: "host",
      root: "/Users/dev",
      codexPath: "/Users/dev/.codex",
      claudePath: "/Users/dev/.claude"
    });
    assert.deepEqual(buildVerftBaseMountArgsForSource(source), [
      "-v",
      `/Users/dev/.codex:${VERFT_BASE_CONTAINER_ROOT}/codex:rw`,
      "-v",
      `/Users/dev/.claude:${VERFT_BASE_CONTAINER_ROOT}/claude:rw`
    ]);
    assert.deepEqual(buildVerftBaseMountArgsForSource(source, "ro"), [
      "-v",
      `/Users/dev/.codex:${VERFT_BASE_CONTAINER_ROOT}/codex:ro`,
      "-v",
      `/Users/dev/.claude:${VERFT_BASE_CONTAINER_ROOT}/claude:ro`
    ]);
  });

  it("allows explicit provider paths without a shared host root", () => {
    const source = evaluateVerftBaseStateSource({
      volume: "verft_base",
      codexHostPath: "/state/codex",
      claudeHostPath: "/state/claude"
    });

    assert.deepEqual(source, {
      type: "host",
      root: "",
      codexPath: "/state/codex",
      claudePath: "/state/claude"
    });
  });
});
