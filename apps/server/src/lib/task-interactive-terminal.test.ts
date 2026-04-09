import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildGitTerminalStartScript } from "./task-interactive-terminal-start-script.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const gitTerminalShellPath = path.join(repoRoot, "tools/codex-web-terminal/git-terminal-shell.sh");
const gitTerminalDockerfilePath = path.join(repoRoot, "tools/codex-web-terminal/Dockerfile.git");

describe("buildGitTerminalStartScript", () => {
  it("generates shell syntax that parses under sh", () => {
    const script = buildGitTerminalStartScript();
    const result = spawnSync("sh", ["-n", "-c", script], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || "expected sh -n to accept git terminal start script");
    assert.match(script, /\n\s+printf '%s\\n'/);
    assert.doesNotMatch(script, /then;\s/);
    assert.match(script, /exec git-terminal-shell$/);
  });

  it("ships the git terminal wrapper with a restricted bash shell", () => {
    const shellScript = readFileSync(gitTerminalShellPath, "utf8");
    const dockerfile = readFileSync(gitTerminalDockerfilePath, "utf8");
    const result = spawnSync("sh", ["-n", gitTerminalShellPath], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || "expected sh -n to accept git terminal shell wrapper");
    assert.match(shellScript, /exec \/bin\/bash --noprofile --norc --restricted -i/);
    assert.match(dockerfile, /\bapk add --no-cache bash git vim diffutils ca-certificates\b/);
  });
});
