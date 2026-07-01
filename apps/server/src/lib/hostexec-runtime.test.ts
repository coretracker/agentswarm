import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildHostexecRuntimeConfig, HOSTEXEC_CONTAINER_BIN_PATH } from "./hostexec-runtime.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.HOSTEXEC_TOKEN_TEST;
});

describe("buildHostexecRuntimeConfig", () => {
  it("creates read-only shims only for daemon-allowed repository commands", async () => {
    process.env.HOSTEXEC_TOKEN_TEST = "secret-token";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(input), "http://hostexec.test/capabilities");
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer secret-token");
      return new Response(JSON.stringify({ commands: ["xcodebuild", "gradlew"] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const payloadDir = path.join("/runtime-payloads", `hostexec-runtime-${Date.now()}`);
    await mkdir(payloadDir, { recursive: true });
    try {
      const result = await buildHostexecRuntimeConfig({
        settings: {
          enabled: true,
          url: "http://hostexec.test",
          bearerTokenEnvVar: "HOSTEXEC_TOKEN_TEST"
        },
        repositoryCommands: ["xcodebuild", "security"],
        payloadDir,
        taskId: "task-1",
        repoId: "repo-1",
        containerWorkspacePath: "/task-workspaces/task-1",
        hostWorkspacePath: "/host/task-workspaces/task-1"
      });

      assert.equal(result.enabled, true);
      assert.deepEqual(result.commands, ["xcodebuild"]);
      assert.deepEqual(result.mountArgs, [
        "--mount",
        `type=volume,src=agentswarm_runtime_payloads,dst=${HOSTEXEC_CONTAINER_BIN_PATH},volume-subpath=${path.relative("/runtime-payloads", path.join(payloadDir, "hostexec-bin"))},readonly`
      ]);
      const env = Object.fromEntries(result.envEntries);
      assert.equal(env.HOSTEXEC_URL, "http://hostexec.test");
      assert.equal(env.HOSTEXEC_TOKEN, "secret-token");
      assert.equal(env.HOSTEXEC_WORKSPACE_ROOT, "/task-workspaces/task-1");
      assert.equal(env.HOSTEXEC_HOST_WORKSPACE_ROOT, "/host/task-workspaces/task-1");
      assert.match(env.PATH, new RegExp(`^${HOSTEXEC_CONTAINER_BIN_PATH}:`));

      const shim = await readFile(path.join(payloadDir, "hostexec-bin", "xcodebuild"), "utf8");
      assert.match(shim, /hostexec-proxy\.mjs/);
      assert.match(shim, /xcodebuild/);
    } finally {
      await rm(payloadDir, { recursive: true, force: true });
    }
  });

  it("skips hostexec when disabled or no repository commands are configured", async () => {
    const result = await buildHostexecRuntimeConfig({
      settings: {
        enabled: false,
        url: "http://hostexec.test",
        bearerTokenEnvVar: null
      },
      repositoryCommands: ["xcodebuild"],
      payloadDir: "/runtime-payloads/task-1/run-1",
      taskId: "task-1",
      repoId: "repo-1",
      containerWorkspacePath: "/workspace",
      hostWorkspacePath: "/host/workspace"
    });

    assert.equal(result.enabled, false);
    assert.deepEqual(result.envEntries, []);
    assert.deepEqual(result.mountArgs, []);
  });
});
