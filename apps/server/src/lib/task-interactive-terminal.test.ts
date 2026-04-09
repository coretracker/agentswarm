import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { buildGitTerminalStartScript } from "./task-interactive-terminal-start-script.js";

describe("buildGitTerminalStartScript", () => {
  it("generates shell syntax that parses under sh", () => {
    const script = buildGitTerminalStartScript();
    const result = spawnSync("sh", ["-n", "-c", script], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || "expected sh -n to accept git terminal start script");
    assert.match(script, /\n\s+printf '%s\\n'/);
    assert.doesNotMatch(script, /then;\s/);
  });
});
