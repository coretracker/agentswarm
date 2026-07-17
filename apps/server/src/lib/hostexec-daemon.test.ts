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

function startDaemon(
  port: number,
  options: { commands?: string; env?: Record<string, string> } = {}
): {
  child: ChildProcess;
  waitForStdout: (match: (line: string) => boolean) => Promise<string>;
  waitForStderr: (match: (line: string) => boolean) => Promise<string>;
} {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const pending: Array<{
    match: (line: string) => boolean;
    resolve: (line: string) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  const child = spawn(process.execPath, [daemonPath, "--host", "127.0.0.1", "--port", String(port)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...options.env,
      HOSTEXEC_COMMANDS: options.commands ?? "node",
      HOSTEXEC_HOST: "127.0.0.1",
      HOSTEXEC_PORT: String(port),
      HOSTEXEC_TOKEN: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const waitForLine = (lines: string[], match: (line: string) => boolean): Promise<string> =>
    new Promise((resolve, reject) => {
      const existing = lines.find(match);
      if (existing) {
        resolve(existing);
        return;
      }
      const timeout = setTimeout(
        () => reject(new Error(`timed out waiting for hostexec log; stderr=${stderrLines.join("\n")}`)),
        5_000
      );
      pending.push({
        match,
        resolve,
        reject,
        timeout
      });
    });

  const handleLine = (line: string, lines: string[]): void => {
    lines.push(line);
    const index = pending.findIndex((entry) => entry.match(line));
    if (index === -1) {
      return;
    }
    const [entry] = pending.splice(index, 1);
    clearTimeout(entry.timeout);
    entry.resolve(line);
  };
  child.stdout?.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line) {
        handleLine(line, stdoutLines);
      }
    }
  });
  child.stderr?.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line) {
        handleLine(line, stderrLines);
      }
    }
  });
  child.on("close", (code, signal) => {
    const error = new Error(
      `hostexec daemon exited before expected log; code=${code ?? "null"} signal=${signal ?? "null"} stderr=${stderrLines.join("\n")}`
    );
    for (const entry of pending.splice(0)) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
  });

  return {
    child,
    waitForStdout: (match) => waitForLine(stdoutLines, match),
    waitForStderr: (match) => waitForLine(stderrLines, match)
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
      assert.equal(typeof started.spawn, "object");
      assert.equal(JSON.stringify(started).includes("process.stdout.write"), false);
      assert.equal(completed.event, "hostexec.exec.completed");
      assert.equal(completed.exitCode, 0);
    } finally {
      daemon.child.kill("SIGTERM");
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("logs spawn diagnostics when an allowed command cannot be found", async () => {
    const port = await findFreePort();
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hostexec-daemon-workspace-"));
    const emptyPathDir = await mkdtemp(path.join(tmpdir(), "hostexec-daemon-empty-path-"));
    const daemon = startDaemon(port, { commands: "missing-tool", env: { PATH: emptyPathDir } });

    try {
      await daemon.waitForStdout((line) => line.includes("hostexec daemon listening"));
      const response = await fetch(`http://127.0.0.1:${port}/exec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "missing-tool",
          argv: ["secret-arg"],
          cwdRelativePath: ".",
          hostWorkspaceRoot: workspaceRoot,
          taskId: "task-2",
          repoId: "repo-2"
        })
      });

      assert.equal(response.ok, true);
      assert.match(await response.text(), /spawn missing-tool ENOENT/);
      const failed = JSON.parse(await daemon.waitForStderr((line) => line.includes("hostexec.exec.spawn_failed"))) as Record<
        string,
        unknown
      >;
      const spawnDiagnostics = failed.spawn as Record<string, unknown>;

      assert.equal(failed.event, "hostexec.exec.spawn_failed");
      assert.equal(failed.command, "missing-tool");
      assert.equal(failed.errorCode, "ENOENT");
      assert.equal(failed.spawnPath, "missing-tool");
      assert.equal(spawnDiagnostics.pathSet, true);
      assert.equal(spawnDiagnostics.pathEntryCount, 1);
      assert.deepEqual(spawnDiagnostics.pathEntries, [emptyPathDir]);
      assert.equal(spawnDiagnostics.resolvedExecutable, null);
      assert.equal(spawnDiagnostics.cwdExists, true);
      assert.equal(JSON.stringify(failed).includes("secret-arg"), false);
    } finally {
      daemon.child.kill("SIGTERM");
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(emptyPathDir, { recursive: true, force: true });
    }
  });

  it("rejects a missing cwd before spawning the command", async () => {
    const port = await findFreePort();
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hostexec-daemon-workspace-"));
    const daemon = startDaemon(port);

    try {
      await daemon.waitForStdout((line) => line.includes("hostexec daemon listening"));
      const response = await fetch(`http://127.0.0.1:${port}/exec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: "node",
          argv: ["-e", "process.stdout.write('should-not-run')"],
          cwdRelativePath: "missing",
          hostWorkspaceRoot: workspaceRoot,
          taskId: "task-3",
          repoId: "repo-3"
        })
      });

      assert.equal(response.status, 400);
      assert.equal(await response.text(), "cwd does not exist: missing\n");
      const rejected = JSON.parse(await daemon.waitForStderr((line) => line.includes("hostexec.exec.rejected"))) as Record<
        string,
        unknown
      >;

      assert.equal(rejected.reason, "missing_cwd");
      assert.equal(rejected.cwdRelativePath, "missing");
      assert.equal(rejected.hostWorkspaceRoot, workspaceRoot);
      assert.equal(rejected.hostWorkspaceRootExists, true);
      assert.equal(JSON.stringify(rejected).includes("should-not-run"), false);
    } finally {
      daemon.child.kill("SIGTERM");
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
