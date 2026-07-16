import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const daemonPath = path.join(repoRoot, "hostexec/daemon.mjs");

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

function startDaemon(port: number): {
  child: ChildProcess;
  waitForStdout: (match: (line: string) => boolean) => Promise<string>;
} {
  const stdoutLines: string[] = [];
  const pending: Array<{ match: (line: string) => boolean; resolve: (line: string) => void }> = [];
  const child = spawn("node", [daemonPath, "--host", "127.0.0.1", "--port", String(port)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOSTEXEC_COMMANDS: "node",
      HOSTEXEC_HOST: "127.0.0.1",
      HOSTEXEC_PORT: String(port),
      HOSTEXEC_TOKEN: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const handleLine = (line: string): void => {
    stdoutLines.push(line);
    const index = pending.findIndex((entry) => entry.match(line));
    if (index === -1) {
      return;
    }
    const [entry] = pending.splice(index, 1);
    entry.resolve(line);
  };
  child.stdout?.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line) {
        handleLine(line);
      }
    }
  });

  return {
    child,
    waitForStdout: (match) =>
      new Promise((resolve, reject) => {
        const existing = stdoutLines.find(match);
        if (existing) {
          resolve(existing);
          return;
        }
        const timeout = setTimeout(() => reject(new Error("timed out waiting for hostexec log")), 5_000);
        pending.push({
          match,
          resolve: (line) => {
            clearTimeout(timeout);
            resolve(line);
          }
        });
      })
  };
}

describe("hostexec daemon", () => {
  it("logs command execution start and completion without logging argv", async () => {
    const port = await findFreePort();
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hostexec-daemon-workspace-"));
    const cwd = path.join(workspaceRoot, "ios");
    await mkdir(cwd);
    const daemon = startDaemon(port);

    try {
      await daemon.waitForStdout((line) => line.includes("hostexec daemon listening"));
      const response = await fetch(`http://127.0.0.1:${port}/exec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "node",
          argv: ["-e", "process.stdout.write('ok')"],
          cwdRelativePath: "ios",
          hostWorkspaceRoot: workspaceRoot,
          taskId: "task-1",
          repoId: "repo-1"
        })
      });

      assert.equal(response.ok, true);
      assert.match(await response.text(), /"stdout":"ok"/);
      const started = JSON.parse(await daemon.waitForStdout((line) => line.includes("hostexec.exec.started"))) as Record<string, unknown>;
      const completed = JSON.parse(await daemon.waitForStdout((line) => line.includes("hostexec.exec.completed"))) as Record<string, unknown>;

      assert.equal(started.event, "hostexec.exec.started");
      assert.equal(started.command, "node");
      assert.equal(started.argc, 2);
      assert.equal(started.cwdRelativePath, "ios");
      assert.equal(started.taskId, "task-1");
      assert.equal(JSON.stringify(started).includes("process.stdout.write"), false);
      assert.equal(completed.event, "hostexec.exec.completed");
      assert.equal(completed.exitCode, 0);
    } finally {
      daemon.child.kill("SIGTERM");
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
