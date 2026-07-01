#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 38128;

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

function runCommand(response, payload) {
  const command = typeof payload.command === "string" ? payload.command.trim() : "";
  const argv = Array.isArray(payload.argv) ? payload.argv.map((value) => String(value)) : [];
  const hostWorkspaceRoot = typeof payload.hostWorkspaceRoot === "string" ? payload.hostWorkspaceRoot.trim() : "";
  const cwdRelativePath = typeof payload.cwdRelativePath === "string" ? payload.cwdRelativePath : ".";

  if (!COMMAND_PATTERN.test(command)) {
    sendText(response, 400, "invalid command name");
    return;
  }
  if (!allowAllCommands && !allowedCommandSet.has(command.toLowerCase())) {
    sendText(response, 403, `command is not allowed by hostexec daemon: ${command}`);
    return;
  }
  if (!hostWorkspaceRoot) {
    sendText(response, 400, "hostWorkspaceRoot is required");
    return;
  }

  let cwd;
  try {
    cwd = resolveCwd(hostWorkspaceRoot, cwdRelativePath);
  } catch (error) {
    sendText(response, 400, error instanceof Error ? error.message : "invalid cwd");
    return;
  }

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
    writeNdjson(response, { stderr: `${error.message}\n`, exitCode: 127 });
    response.end();
  });
  child.on("close", (exitCode, signal) => {
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
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  if (token && request.headers.authorization !== `Bearer ${token}`) {
    sendText(response, 401, "unauthorized");
    return;
  }

  if (request.method === "GET" && url.pathname === "/capabilities") {
    sendJson(response, 200, { allowAll: allowAllCommands, commands: configuredCommands });
    return;
  }

  if (request.method === "POST" && url.pathname === "/exec") {
    try {
      runCommand(response, await readJsonBody(request));
    } catch (error) {
      sendText(response, 400, error instanceof Error ? error.message : "invalid request");
    }
    return;
  }

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
