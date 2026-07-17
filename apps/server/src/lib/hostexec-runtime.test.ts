import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { env } from "../config/env.js";
import {
  buildHostexecRuntimeConfig,
  HOSTEXEC_CONTAINER_BIN_PATH,
  HOSTEXEC_SHELL_ENV_PATH,
  normalizeHostexecHostWorkspacePath
} from "./hostexec-runtime.js";

const originalFetch = globalThis.fetch;
const originalRuntimePayloadRoot = env.RUNTIME_PAYLOAD_ROOT;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.RUNTIME_PAYLOAD_ROOT = originalRuntimePayloadRoot;
  delete process.env.HOSTEXEC_TOKEN_TEST;
});

describe("buildHostexecRuntimeConfig", () => {
  async function withPayloadDir<T>(run: (payloadDir: string) => Promise<T>): Promise<T> {
    const fixtureRoot = process.env.VERFT_TEST_FIXTURE_ROOT ?? path.join(process.cwd(), ".tmp", "harness-tests");
    env.RUNTIME_PAYLOAD_ROOT = path.join(fixtureRoot, "runtime-payloads");
    const payloadDir = path.join(env.RUNTIME_PAYLOAD_ROOT, `hostexec-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(payloadDir, { recursive: true });
    try {
      return await run(payloadDir);
    } finally {
      await rm(payloadDir, { recursive: true, force: true });
    }
  }

  it("normalizes Docker Desktop macOS mount paths for hostexec cwd", () => {
    assert.equal(
      normalizeHostexecHostWorkspacePath("/host_mnt/Users/andreas/project/task-workspaces/task-1", "darwin"),
      "/Users/andreas/project/task-workspaces/task-1"
    );
    assert.equal(
      normalizeHostexecHostWorkspacePath("/host_mnt/Users/andreas/project/task-workspaces/task-1", "linux"),
      "/host_mnt/Users/andreas/project/task-workspaces/task-1"
    );
  });

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

    await withPayloadDir(async (payloadDir) => {
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
        `type=volume,src=verft_runtime_payloads,dst=${HOSTEXEC_CONTAINER_BIN_PATH},volume-subpath=${path.relative(env.RUNTIME_PAYLOAD_ROOT, path.join(payloadDir, "hostexec-bin"))},readonly`
      ]);
      const resultEnv = Object.fromEntries(result.envEntries);
      assert.equal(resultEnv.HOSTEXEC_URL, "http://hostexec.test");
      assert.equal(resultEnv.HOSTEXEC_TOKEN, "secret-token");
      assert.equal(resultEnv.HOSTEXEC_WORKSPACE_ROOT, "/task-workspaces/task-1");
      assert.equal(resultEnv.HOSTEXEC_HOST_WORKSPACE_ROOT, "/host/task-workspaces/task-1");
      assert.equal(resultEnv.BASH_ENV, HOSTEXEC_SHELL_ENV_PATH);
      assert.match(resultEnv.PATH, new RegExp(`^${HOSTEXEC_CONTAINER_BIN_PATH}:`));

      const shim = await readFile(path.join(payloadDir, "hostexec-bin", "xcodebuild"), "utf8");
      assert.match(shim, /hostexec-proxy\.mjs/);
      assert.match(shim, /xcodebuild/);
      const shellEnv = await readFile(path.join(payloadDir, "hostexec-bin", ".hostexec-shell-env"), "utf8");
      assert.match(shellEnv, new RegExp(HOSTEXEC_CONTAINER_BIN_PATH));
      assert.match(shellEnv, /export PATH=/);
    });
  });

  it("uses repository commands when daemon capabilities allow all commands", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), "http://hostexec.test/capabilities");
      return new Response(JSON.stringify({ allowAll: true, commands: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    await withPayloadDir(async (payloadDir) => {
      const result = await buildHostexecRuntimeConfig({
        settings: {
          enabled: true,
          url: "http://hostexec.test",
          bearerTokenEnvVar: null
        },
        repositoryCommands: ["xcodebuild", "security"],
        payloadDir,
        taskId: "task-1",
        repoId: "repo-1",
        containerWorkspacePath: "/task-workspaces/task-1",
        hostWorkspacePath: "/host/task-workspaces/task-1"
      });

      assert.equal(result.enabled, true);
      assert.deepEqual(result.commands, ["xcodebuild", "security"]);
      assert.match(await readFile(path.join(payloadDir, "hostexec-bin", "security"), "utf8"), /security/);
    });
  });

  it("passes normalized macOS host cwd to the hostexec proxy", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), "http://hostexec.test/capabilities");
      return new Response(JSON.stringify({ allowAll: true, commands: [], platform: "darwin", arch: "arm64" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    await withPayloadDir(async (payloadDir) => {
      const result = await buildHostexecRuntimeConfig({
        settings: {
          enabled: true,
          url: "http://hostexec.test",
          bearerTokenEnvVar: null
        },
        repositoryCommands: ["xcodebuild"],
        payloadDir,
        taskId: "task-1",
        repoId: "repo-1",
        containerWorkspacePath: "/task-workspaces/task-1",
        hostWorkspacePath: "/host_mnt/Users/andreas/project/task-workspaces/task-1"
      });

      const resultEnv = Object.fromEntries(result.envEntries);
      assert.equal(resultEnv.HOSTEXEC_HOST_WORKSPACE_ROOT, "/Users/andreas/project/task-workspaces/task-1");
    });
  });

  it("autodetects the default host daemon URL when no URL is configured", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), "http://host.docker.internal:38128/capabilities");
      return new Response(JSON.stringify({ allowAll: true, commands: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    await withPayloadDir(async (payloadDir) => {
      const result = await buildHostexecRuntimeConfig({
        settings: {
          enabled: false,
          url: null,
          bearerTokenEnvVar: null
        },
        repositoryCommands: ["xcodebuild"],
        payloadDir,
        taskId: "task-1",
        repoId: "repo-1",
        containerWorkspacePath: "/workspace",
        hostWorkspacePath: "/host/workspace"
      });

      assert.equal(result.enabled, true);
      assert.deepEqual(result.commands, ["xcodebuild"]);
      assert.equal(Object.fromEntries(result.envEntries).HOSTEXEC_URL, "http://host.docker.internal:38128");
    });
  });

  it("avoids add-host and prefers the bridge host URL when sharing the server container network", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), "http://172.17.0.1:38128/capabilities");
      return new Response(JSON.stringify({ allowAll: true, commands: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    await withPayloadDir(async (payloadDir) => {
      const result = await buildHostexecRuntimeConfig({
        settings: {
          enabled: false,
          url: null,
          bearerTokenEnvVar: null
        },
        repositoryCommands: ["xcodebuild"],
        payloadDir,
        taskId: "task-1",
        repoId: "repo-1",
        containerWorkspacePath: "/workspace",
        hostWorkspacePath: "/host/workspace",
        sharedNetworkWithCurrentContainer: true
      });

      assert.equal(result.enabled, true);
      assert.deepEqual(result.dockerArgs, []);
      assert.equal(Object.fromEntries(result.envEntries).HOSTEXEC_URL, "http://172.17.0.1:38128");
    });
  });

  it("skips hostexec when no repository commands are configured", async () => {
    const result = await buildHostexecRuntimeConfig({
      settings: {
        enabled: false,
        url: "http://hostexec.test",
        bearerTokenEnvVar: null
      },
      repositoryCommands: [],
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
