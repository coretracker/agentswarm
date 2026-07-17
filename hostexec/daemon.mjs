#!/usr/bin/env node
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 38128;
let nextRequestId = 1;

function parseCliOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host" && argv[index + 1]) {
      options.host = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
      continue;
    }
    if (arg === "--port" && argv[index + 1]) {
      options.port = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      options.port = arg.slice("--port=".length);
    }
  }
  return options;
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue;
    }
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function normalizeCommands(raw) {
  const commands = [];
  const seen = new Set();
  for (const value of raw.split(/[\s,]+/)) {
    const command = value.trim();
    const key = command.toLowerCase();
    if (!command || seen.has(key) || !COMMAND_PATTERN.test(command)) {
      continue;
    }
    seen.add(key);
    commands.push(command);
  }
  return commands;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(`${message}\n`);
}

function logEvent(level, event, data = {}) {
  const payload = {
    type: "hostexec",
    event,
    ...data
  };
  console[level](JSON.stringify(payload));
}

function getPathEntries(env = process.env) {
  return String(env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(command, env = process.env) {
  for (const entry of getPathEntries(env)) {
    const candidate = path.resolve(entry, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildSpawnDiagnostics(command, cwd, env = process.env) {
  const pathEntries = getPathEntries(env);
  const resolvedExecutable = resolveExecutable(command, env);
  const diagnostics = {
    platform: process.platform,
    arch: process.arch,
    cwdExists: existsSync(cwd),
    pathSet: typeof env.PATH === "string" && env.PATH.length > 0,
    pathEntryCount: pathEntries.length,
    pathEntries,
    resolvedExecutable
  };

  if (process.platform === "darwin") {
    diagnostics.pathIncludesUsrBin = pathEntries.includes("/usr/bin");
    diagnostics.usrBinXcodebuildExecutable = command === "xcodebuild" ? isExecutable("/usr/bin/xcodebuild") : undefined;
  }

  return diagnostics;
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new Error("request body too large");
    }
  }
  return body.trim() ? JSON.parse(body) : {};
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveCwd(hostWorkspaceRoot, cwdRelativePath) {
  const root = path.resolve(hostWorkspaceRoot);
  const relative = typeof cwdRelativePath === "string" && cwdRelativePath.trim() ? cwdRelativePath : ".";
  const cwd = path.resolve(root, relative);
  if (!isInside(root, cwd)) {
    throw new Error("cwd escapes host workspace root");
  }
  return cwd;
}

function writeNdjson(response, event) {
  response.write(`${JSON.stringify(event)}\n`);
}

function runCommand(response, payload, context) {
  const command = typeof payload.command === "string" ? payload.command.trim() : "";
  const argv = Array.isArray(payload.argv) ? payload.argv.map((value) => String(value)) : [];
  const hostWorkspaceRoot = typeof payload.hostWorkspaceRoot === "string" ? payload.hostWorkspaceRoot.trim() : "";
  const cwdRelativePath = typeof payload.cwdRelativePath === "string" ? payload.cwdRelativePath : ".";
  const taskId = typeof payload.taskId === "string" ? payload.taskId.trim() : "";
  const repoId = typeof payload.repoId === "string" ? payload.repoId.trim() : "";

  if (!COMMAND_PATTERN.test(command)) {
    logEvent("warn", "hostexec.exec.rejected", {
      requestId: context.requestId,
      reason: "invalid_command",
      remoteAddress: context.remoteAddress
    });
    sendText(response, 400, "invalid command name");
    return;
  }
  if (!allowAllCommands && !allowedCommandSet.has(command.toLowerCase())) {
    logEvent("warn", "hostexec.exec.rejected", {
      requestId: context.requestId,
      command,
      reason: "command_not_allowed",
      remoteAddress: context.remoteAddress,
      taskId,
      repoId
    });
    sendText(response, 403, `command is not allowed by hostexec daemon: ${command}`);
    return;
  }
  if (!hostWorkspaceRoot) {
    logEvent("warn", "hostexec.exec.rejected", {
      requestId: context.requestId,
      command,
      reason: "missing_host_workspace_root",
      remoteAddress: context.remoteAddress,
      taskId,
      repoId
    });
    sendText(response, 400, "hostWorkspaceRoot is required");
    return;
  }

  let cwd;
  try {
    cwd = resolveCwd(hostWorkspaceRoot, cwdRelativePath);
  } catch (error) {
    logEvent("warn", "hostexec.exec.rejected", {
      requestId: context.requestId,
      command,
      reason: "invalid_cwd",
      remoteAddress: context.remoteAddress,
      taskId,
      repoId
    });
    sendText(response, 400, error instanceof Error ? error.message : "invalid cwd");
    return;
  }
  if (!existsSync(cwd)) {
    logEvent("warn", "hostexec.exec.rejected", {
      requestId: context.requestId,
      command,
      reason: "missing_cwd",
      cwd,
      cwdRelativePath: cwdRelativePath || ".",
      hostWorkspaceRoot: path.resolve(hostWorkspaceRoot),
      hostWorkspaceRootExists: existsSync(path.resolve(hostWorkspaceRoot)),
      remoteAddress: context.remoteAddress,
      taskId,
      repoId
    });
    sendText(response, 400, `cwd does not exist: ${cwdRelativePath || "."}`);
    return;
  }

  const startedAt = Date.now();
  logEvent("info", "hostexec.exec.started", {
    requestId: context.requestId,
    command,
    argc: argv.length,
    cwdRelativePath: cwdRelativePath || ".",
    remoteAddress: context.remoteAddress,
    spawn: buildSpawnDiagnostics(command, cwd),
    taskId,
    repoId
  });
  response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
  const child = spawn(command, argv, {
    cwd,
    env: process.env,
    shell: false,
    windowsHide: true
  });

  child.stdout.on("data", (chunk) => writeNdjson(response, { stdout: chunk.toString() }));
  child.stderr.on("data", (chunk) => writeNdjson(response, { stderr: chunk.toString() }));
  child.on("error", (error) => {
    logEvent("error", "hostexec.exec.spawn_failed", {
      requestId: context.requestId,
      command,
      durationMs: Date.now() - startedAt,
      error: error.message,
      errorCode: error.code,
      syscall: error.syscall,
      spawnPath: error.path,
      spawn: buildSpawnDiagnostics(command, cwd),
      taskId,
      repoId
    });
    writeNdjson(response, { stderr: `${error.message}\n`, exitCode: 127 });
    response.end();
  });
  child.on("close", (exitCode, signal) => {
    logEvent(exitCode === 0 && !signal ? "info" : "warn", "hostexec.exec.completed", {
      requestId: context.requestId,
      command,
      durationMs: Date.now() - startedAt,
      exitCode: exitCode ?? null,
      signal: signal ?? null,
      taskId,
      repoId
    });
    if (signal) {
      writeNdjson(response, { stderr: `terminated by ${signal}\n`, exitCode: 1 });
    } else {
      writeNdjson(response, { exitCode: exitCode ?? 0 });
    }
    response.end();
  });
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(repoRoot, ".env"));

const cliOptions = parseCliOptions(process.argv.slice(2));
const host = cliOptions.host?.trim() || process.env.HOSTEXEC_HOST?.trim() || DEFAULT_HOST;
const port = Number.parseInt(cliOptions.port ?? process.env.HOSTEXEC_PORT ?? "", 10) || DEFAULT_PORT;
const token = process.env.HOSTEXEC_TOKEN?.trim() || "";
const rawConfiguredCommands = process.env.HOSTEXEC_COMMANDS ?? "";
const configuredCommands = normalizeCommands(rawConfiguredCommands);
const allowAllCommands = rawConfiguredCommands.trim().length === 0;
const allowedCommandSet = new Set(configuredCommands.map((command) => command.toLowerCase()));

const server = http.createServer(async (request, response) => {
  const requestId = nextRequestId;
  nextRequestId += 1;
  const remoteAddress = request.socket.remoteAddress ?? "";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  if (token && request.headers.authorization !== `Bearer ${token}`) {
    logEvent("warn", "hostexec.request.rejected", {
      requestId,
      method: request.method,
      path: url.pathname,
      reason: "unauthorized",
      remoteAddress
    });
    sendText(response, 401, "unauthorized");
    return;
  }

  if (request.method === "GET" && url.pathname === "/capabilities") {
    logEvent("info", "hostexec.capabilities.requested", { requestId, remoteAddress });
    sendJson(response, 200, {
      allowAll: allowAllCommands,
      commands: configuredCommands,
      platform: process.platform,
      arch: process.arch
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/exec") {
    try {
      runCommand(response, await readJsonBody(request), { requestId, remoteAddress });
    } catch (error) {
      logEvent("warn", "hostexec.exec.rejected", {
        requestId,
        reason: "invalid_request",
        remoteAddress
      });
      sendText(response, 400, error instanceof Error ? error.message : "invalid request");
    }
    return;
  }

  logEvent("warn", "hostexec.request.rejected", {
    requestId,
    method: request.method,
    path: url.pathname,
    reason: "not_found",
    remoteAddress
  });
  sendText(response, 404, "not found");
});

server.listen(port, host, () => {
  const commandSummary = allowAllCommands
    ? "all valid command names"
    : configuredCommands.length > 0
      ? configuredCommands.join(", ")
      : "none";
  console.log(`hostexec daemon listening on http://${host}:${port}`);
  console.log(`hostexec commands: ${commandSummary}`);
  console.log(`hostexec token auth: ${token ? "enabled" : "disabled"}`);
});
