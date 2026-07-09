import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import type { McpServerConfig, PermissionScope, User } from "@verft/shared-types";
import { env } from "../config/env.js";
import { getProviderRuntimeDefinition } from "../providers/runtime-definitions.js";
import { parseAgentJsonlEvents } from "../lib/agent-event-parser.js";
import type { PersonalAccessTokenStore } from "./personal-access-token-store.js";
import type { SettingsStore } from "./settings-store.js";
import type { AssistantSession, AssistantSessionStore } from "./assistant-session-store.js";
import type { AssistantPolicyStore } from "./assistant-policy-store.js";

const execFileAsync = promisify(execFile);
const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 80);

export class AssistantRuntimeService {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly activeContainers = new Map<string, string>();
  private activeRuns = 0;

  constructor(
    private readonly deps: {
      sessionStore: AssistantSessionStore;
      settingsStore: SettingsStore;
      personalAccessTokenStore: PersonalAccessTokenStore;
      policyStore: AssistantPolicyStore;
    }
  ) {}

  async clearSessionState(sessionId: string): Promise<void> {
    const container = this.activeContainers.get(sessionId);
    if (container) {
      await execFileAsync("docker", ["rm", "-f", container]).catch(() => undefined);
      this.activeContainers.delete(sessionId);
    }
    await rm(path.join(env.RUNTIME_PAYLOAD_ROOT, "assistant", safeSegment(sessionId), "state"), {
      recursive: true,
      force: true
    });
  }

  async respond(user: User, session: AssistantSession, text: string, externalId?: string): Promise<string> {
    const previous = this.queues.get(session.id) ?? Promise.resolve();
    let resolveQueue!: () => void;
    const current = new Promise<void>((resolve) => { resolveQueue = resolve; });
    const queued = previous.then(() => current);
    this.queues.set(session.id, queued);
    await previous;
    let acquired = false;
    try {
      const policy = await this.deps.policyStore.get();
      if (this.activeRuns >= policy.maxConcurrentRuns) {
        await this.deps.sessionStore.appendEvent(session.id, "error", "Assistant concurrency limit reached");
        throw new Error("Assistant concurrency limit reached");
      }
      this.activeRuns += 1;
      acquired = true;
      return await this.execute(user, session, text, externalId);
    } finally {
      if (acquired) this.activeRuns -= 1;
      resolveQueue();
      if (this.queues.get(session.id) === queued) {
        this.queues.delete(session.id);
      }
    }
  }

  private async execute(user: User, session: AssistantSession, text: string, externalId?: string): Promise<string> {
    await this.deps.sessionStore.appendEvent(session.id, "user_message", text, externalId ? { externalId } : {});
    const [settings, credentials, events, policy] = await Promise.all([
      this.deps.settingsStore.getSettings(),
      this.deps.settingsStore.getRuntimeCredentials(user.id, "auto"),
      this.deps.sessionStore.listEvents(user.id, session.id, 80),
      this.deps.policyStore.get()
    ]);
    await this.deps.sessionStore.deleteExpiredEvents(policy.retentionDays);
    const definition = getProviderRuntimeDefinition(session.provider);
    const token = await this.deps.personalAccessTokenStore.createToken({
      userId: user.id,
      name: `Assistant runtime ${session.id}`,
      scopes: policy.mcpScopes as PermissionScope[],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
    const endpoint = existsSync("/.dockerenv")
      ? `http://127.0.0.1:${env.PORT}/mcp`
      : `http://host.docker.internal:${env.PORT}/mcp`;
    const mcpEnv = {
      VERFT_MCP_ENDPOINT: endpoint,
      VERFT_MCP_ENDPOINTS: endpoint,
      VERFT_MCP_TOKEN: token.token
    };
    const servers: McpServerConfig[] = [{
      name: "verft",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: ["/usr/local/bin/verft-mcp-bridge.mjs"],
      env: mcpEnv
    }];
    const executionId = nanoid();
    const root = path.join(env.RUNTIME_PAYLOAD_ROOT, "assistant", safeSegment(session.id));
    const payload = path.join(root, "runs", executionId);
    const workspace = path.join(root, "workspace");
    const state = path.join(root, "state", session.provider);
    const configPath = path.join(payload, definition.configFileName);
    const manifestPath = path.join(payload, "manifest.json");
    const resultPath = path.join(payload, "result.json");
    const rawEventsPath = path.join(payload, "raw-events.jsonl");
    await Promise.all([mkdir(payload, { recursive: true }), mkdir(workspace, { recursive: true }), mkdir(state, { recursive: true })]);
    const transcript = events.map((event) => `${event.kind}: ${event.content}`).join("\n");
    const profile = session.effort;
    const model = definition.getResolvedModel(session.model, profile);
    const profileSettings = definition.getResolvedProfileSettings(profile, model);
    await Promise.all([
      writeFile(configPath, definition.getProviderConfig(servers), "utf8"),
      writeFile(resultPath, "", "utf8"),
      writeFile(manifestPath, JSON.stringify({
        id: session.id,
        taskType: "ask",
        action: "ask",
        provider: session.provider,
        providerProfile: profile,
        resolvedModel: model,
        resolvedReasoningEffort: profileSettings.reasoningEffort,
        resolvedThinkingBudgetTokens: profileSettings.thinkingBudgetTokens,
        workspacePath: workspace,
        resultMarkdownPath: path.join(payload, "result.md"),
        resultJsonPath: resultPath,
        rawEventsJsonlPath: rawEventsPath,
        agentResponsePreference: user.agentResponsePreference,
        content: [
          "You are Verft's user-scoped Slack assistant. No repository is mounted.",
          "Use Verft MCP as the source of truth. Mutate data only when explicitly requested.",
          "Keep replies concise. Never claim a tool succeeded without its result.",
          "",
          transcript,
          "",
          `Latest user message: ${text}`
        ].join("\n")
      }, null, 2), "utf8")
    ]);
    const containerName = `verft-assistant-${safeSegment(executionId)}`;
    const args = [
      "run", "--rm", "--name", containerName,
      ...(existsSync("/.dockerenv") ? ["--network", `container:${hostname()}`] : ["--add-host", "host.docker.internal:host-gateway"]),
      "-v", `${env.RUNTIME_PAYLOAD_VOLUME}:${env.RUNTIME_PAYLOAD_ROOT}:rw`,
      "-e", `TASK_MANIFEST_FILE=${manifestPath}`,
      "-e", `PROVIDER_CONFIG_FILE=${configPath}`,
      "-e", `TASK_WORKSPACE_PATH=${workspace}`,
      "-e", `TASK_PROVIDER_STATE_PATH=${state}`,
      "-e", `TASK_PROVIDER_HOME=${state}`
    ];
    const runtimeEnv = { ...definition.getRuntimeEnv(credentials), ...mcpEnv };
    for (const [key, value] of Object.entries(runtimeEnv)) {
      if (value) args.push("-e", `${key}=${value}`);
    }
    args.push(definition.image, ...definition.command);
    this.activeContainers.set(session.id, containerName);
    try {
      await execFileAsync("docker", args, { maxBuffer: 10 * 1024 * 1024 });
      const result = JSON.parse(await readFile(resultPath, "utf8")) as { summaryMarkdown?: string; sessionId?: string };
      const reply = result.summaryMarkdown?.trim();
      if (!reply) throw new Error("Assistant runtime returned an empty response");
      const rawEvents = await readFile(rawEventsPath, "utf8").catch(() => "");
      for (const event of parseAgentJsonlEvents(session.provider, rawEvents)) {
        if (event.kind === "tool.started" || event.kind === "tool.completed" || event.kind === "tool.failed") {
          await this.deps.sessionStore.appendEvent(
            session.id,
            event.kind === "tool.started" ? "tool_call" : "tool_result",
            event.title,
            { toolName: event.toolName, status: event.status }
          );
        }
      }
      await this.deps.sessionStore.appendEvent(session.id, "assistant_message", reply);
      await this.deps.sessionStore.setProviderSessionId(session.id, result.sessionId ?? null);
      return reply;
    } catch (error) {
      await this.deps.sessionStore.appendEvent(session.id, "error", error instanceof Error ? error.message : "Runtime failed");
      throw error;
    } finally {
      this.activeContainers.delete(session.id);
      await this.deps.personalAccessTokenStore.revokeToken(user.id, token.id).catch(() => null);
    }
  }
}
