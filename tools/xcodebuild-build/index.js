import http from "http";
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

const PORT = 8080;

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, options);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d) => {
      stdout += d.toString("utf8");
    });

    child.stderr?.on("data", (d) => {
      stderr += d.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const err = new Error(`${cmd} exited with code ${code}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

function extractErrors(text) {
  const lines = text.split(/\r?\n/);
  const errors = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (
      trimmed.includes(" error: ") ||
      trimmed.startsWith("error:") ||
      trimmed.includes(": error:")
    ) {
      errors.push(trimmed);
    }
  }

  return [...new Set(errors)];
}

function tailLines(text, maxLines = 80) {
  return text.split(/\r?\n/).filter(Boolean).slice(-maxLines);
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function removeWorktree(repoPath, worktreePath) {
  try {
    await run("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: repoPath,
      env: process.env,
    });
  } catch {}

  try {
    if (await pathExists(worktreePath)) {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  } catch {}
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/xcodebuild") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", async () => {
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
      return;
    }

    const {
      repoPath,
      branch,
      args = [],
      subdir = "",
    } = payload;

    if (!repoPath || typeof repoPath !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "`repoPath` is required" }));
      return;
    }

    if (!branch || typeof branch !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "`branch` is required" }));
      return;
    }

    if (!Array.isArray(args)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "`args` must be an array" }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    });

    let combined = "";
    let worktreePath = "";
    const streamed = new Set();

    const streamLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || streamed.has(trimmed)) return;
      streamed.add(trimmed);
      res.write(trimmed + "\n");
    };

    try {
      const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "xcodebuild-worktree-"));
      worktreePath = path.join(tmpBase, "repo");

      res.write(`PREPARING_WORKTREE:${branch}\n`);

      await run("git", ["fetch", "--all", "--prune"], {
        cwd: repoPath,
        env: process.env,
      });

      await run("git", ["worktree", "add", "--force", worktreePath, branch], {
        cwd: repoPath,
        env: process.env,
      });

      const buildCwd = subdir ? path.join(worktreePath, subdir) : worktreePath;

      res.write(`WORKTREE_PATH:${worktreePath}\n`);
      res.write(`BUILD_CWD:${buildCwd}\n`);

      const child = spawn("xcodebuild", args, {
        cwd: buildCwd,
        env: process.env,
      });

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        combined += text;

        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (
            trimmed.includes(" error: ") ||
            trimmed.startsWith("error:") ||
            trimmed.includes(": error:") ||
            trimmed.includes("BUILD SUCCEEDED") ||
            trimmed.includes("BUILD FAILED")
          ) {
            streamLine(trimmed);
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        combined += text;

        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (
            trimmed.includes(" error: ") ||
            trimmed.startsWith("error:") ||
            trimmed.includes(": error:") ||
            trimmed.includes("BUILD SUCCEEDED") ||
            trimmed.includes("BUILD FAILED")
          ) {
            streamLine(trimmed);
          }
        }
      });

      child.on("error", async (err) => {
        const summary = {
          ok: false,
          exitCode: null,
          repoPath,
          branch,
          worktreePath,
          buildCwd,
          args,
          errors: [`Failed to start xcodebuild: ${err.message}`],
          logTail: tailLines(combined, 40),
        };

        await removeWorktree(repoPath, worktreePath);

        res.write("\n__RESULT__\n");
        res.write(JSON.stringify(summary) + "\n");
        res.end();
      });

      child.on("close", async (code) => {
        const errors = extractErrors(combined);
        const ok = code === 0;

        if (ok && !streamed.has("BUILD SUCCEEDED")) {
          res.write("BUILD SUCCEEDED\n");
        }
        if (!ok && !streamed.has("BUILD FAILED")) {
          res.write("BUILD FAILED\n");
        }

        await removeWorktree(repoPath, worktreePath);

        const summary = {
          ok,
          exitCode: code,
          repoPath,
          branch,
          worktreePath,
          args,
          errors,
          logTail: ok ? [] : tailLines(combined, 80),
          cleanedUp: true,
        };

        res.write("\n__RESULT__\n");
        res.write(JSON.stringify(summary) + "\n");
        res.end();
      });
    } catch (err) {
      if (worktreePath) {
        await removeWorktree(repoPath, worktreePath);
      }

      const summary = {
        ok: false,
        exitCode: null,
        repoPath,
        branch,
        worktreePath,
        args,
        errors: [err.message],
        gitStdout: err.stdout || "",
        gitStderr: err.stderr || "",
        cleanedUp: true,
      };

      res.write("BUILD FAILED\n");
      res.write("\n__RESULT__\n");
      res.write(JSON.stringify(summary) + "\n");
      res.end();
    }
  });
});

server.listen(PORT, () => {
  console.log(`xcodebuild runner listening on ${PORT}`);
});