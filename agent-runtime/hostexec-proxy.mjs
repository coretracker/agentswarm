import path from "node:path";

const command = process.argv[2]?.trim();
const argv = process.argv.slice(3);
const endpoint = process.env.HOSTEXEC_URL?.trim().replace(/\/+$/, "");
const token = process.env.HOSTEXEC_TOKEN?.trim();
const workspaceRoot = process.env.HOSTEXEC_WORKSPACE_ROOT?.trim();
const hostWorkspaceRoot = process.env.HOSTEXEC_HOST_WORKSPACE_ROOT?.trim();
const taskId = process.env.HOSTEXEC_TASK_ID?.trim();
const repoId = process.env.HOSTEXEC_REPO_ID?.trim();
const COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

const fail = (message, code = 1) => {
  console.error(`[hostexec] ${message}`);
  process.exit(code);
};

if (!command || !COMMAND_PATTERN.test(command)) {
  fail("invalid command name");
}
if (!endpoint) {
  fail("HOSTEXEC_URL is required");
}
if (!workspaceRoot || !path.posix.isAbsolute(workspaceRoot)) {
  fail("HOSTEXEC_WORKSPACE_ROOT must be an absolute container path");
}
if (!hostWorkspaceRoot) {
  fail("HOSTEXEC_HOST_WORKSPACE_ROOT is required");
}

const cwd = process.cwd();
const relativeCwd = path.posix.relative(workspaceRoot, cwd);
if (relativeCwd === ".." || relativeCwd.startsWith("../") || path.posix.isAbsolute(relativeCwd)) {
  fail("current directory is outside the task workspace");
}

const writeEvent = (event) => {
  if (!event || typeof event !== "object") {
    return null;
  }
  if (typeof event.stdout === "string") {
    process.stdout.write(event.stdout);
  }
  if (typeof event.stderr === "string") {
    process.stderr.write(event.stderr);
  }
  if (Number.isInteger(event.exitCode)) {
    return Math.max(0, Math.min(255, event.exitCode));
  }
  return null;
};

const response = await fetch(`${endpoint}/exec`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify({
    command,
    argv,
    cwd,
    workspaceRoot,
    cwdRelativePath: relativeCwd === "" ? "." : relativeCwd,
    hostWorkspaceRoot,
    taskId,
    repoId
  })
}).catch((error) => {
  fail(error instanceof Error ? error.message : "request failed");
});

const contentType = response.headers.get("content-type") ?? "";
if (!response.ok) {
  const body = await response.text().catch(() => "");
  fail(body.trim() || `hostexec returned HTTP ${response.status}`);
}

if (contentType.includes("application/x-ndjson") && response.body) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let exitCode = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const eventExitCode = writeEvent(JSON.parse(line));
      if (eventExitCode !== null) {
        exitCode = eventExitCode;
      }
    }
  }
  if (buffer.trim()) {
    const eventExitCode = writeEvent(JSON.parse(buffer));
    if (eventExitCode !== null) {
      exitCode = eventExitCode;
    }
  }
  process.exit(exitCode);
}

const payload = await response.json().catch(() => null);
if (!payload || typeof payload !== "object") {
  fail("hostexec returned an invalid response");
}
const exitCode = writeEvent(payload) ?? 0;
process.exit(exitCode);
