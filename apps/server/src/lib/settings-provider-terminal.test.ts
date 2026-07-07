import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { buildProviderTerminalScript } from "./settings-provider-terminal.js";

describe("buildProviderTerminalScript", () => {
  for (const provider of ["codex", "claude", "setup"] as const) {
    it(`generates shell syntax that parses for ${provider}`, () => {
      const script = buildProviderTerminalScript(provider);
      const result = spawnSync("sh", ["-n", "-c", script], { encoding: "utf8" });

      assert.equal(result.status, 0, result.stderr || `expected ${provider} settings terminal script to parse`);
      assert.match(script, /VERFT_BASE_ROOT/);
      assert.match(script, /trap sync_base_state EXIT HUP INT TERM/);
      assert.match(script, /su-exec agent:agent/);
      if (provider === "setup") {
        assert.match(script, /codex/);
        assert.match(script, /claude/);
        assert.match(script, /ln -s "\$BASE_ROOT\/codex" "\$HOME\/\.codex"/);
        assert.match(script, /ln -s "\$BASE_ROOT\/claude" "\$HOME\/\.claude"/);
        assert.match(script, /ln -s "\$BASE_ROOT\/claude\/\.claude\.json" "\$HOME\/\.claude\.json"/);
      } else {
        assert.match(script, new RegExp(`\\$BASE_ROOT/${provider}`));
      }
    });
  }
});
