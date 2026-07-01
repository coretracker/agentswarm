import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const proxyPath = path.join(repoRoot, "agent-runtime/hostexec-proxy.mjs");

function runProxy(options: { endpoint: string; workspaceRoot: string; cwd: string }): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [proxyPath, "xcodebuild", "-version"], {
      cwd: options.cwd,
      env: {
        ...process.env,
        HOSTEXEC_URL: options.endpoint,
        HOSTEXEC_WORKSPACE_ROOT: options.workspaceRoot,
        HOSTEXEC_HOST_WORKSPACE_ROOT: "/host/workspace",
        HOSTEXEC_TASK_ID: "task-1",
        HOSTEXEC_REPO_ID: "repo-1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("hostexec-proxy", () => {
  it("sends command execution requests with workspace-relative cwd", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hostexec-proxy-workspace-"));
    const nestedCwd = path.join(workspaceRoot, "ios");
    await mkdir(nestedCwd);

    let receivedBody: Record<string, unknown> | null = null;
    const server = createServer((request, response) => {
      assert.equal(request.url, "/exec");
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk.toString();
      });
      request.on("end", () => {
        receivedBody = JSON.parse(raw) as Record<string, unknown>;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ stdout: "Xcode 16.0\n", stderr: "", exitCode: 0 }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const result = await runProxy({
        endpoint: `http://127.0.0.1:${address.port}`,
        workspaceRoot,
        cwd: nestedCwd
      });

      assert.equal(result.code, 0);
      assert.equal(result.stdout, "Xcode 16.0\n");
      assert.equal(result.stderr, "");
      assert.ok(receivedBody);
      const body = receivedBody as Record<string, unknown>;
      assert.equal(body.command, "xcodebuild");
      assert.deepEqual(body.argv, ["-version"]);
      assert.equal(body.cwdRelativePath, "ios");
      assert.equal(body.hostWorkspaceRoot, "/host/workspace");
    } finally {
      server.close();
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects cwd outside the task workspace before contacting hostexec", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hostexec-proxy-workspace-"));
    const outsideCwd = await mkdtemp(path.join(tmpdir(), "hostexec-proxy-outside-"));
    const result = await runProxy({
      endpoint: "http://127.0.0.1:1",
      workspaceRoot,
      cwd: outsideCwd
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /outside the task workspace/);
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(outsideCwd, { recursive: true, force: true });
  });
});
