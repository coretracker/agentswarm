import { z } from "zod";
import {
  getTaskCapabilityScopeForTaskAction,
  getTaskCapabilityScopeForTaskType,
  type AuthSessionUser,
  type PermissionScope,
  type Task,
  type TaskAction
} from "@verft/shared-types";
import { beginTaskStart } from "../lib/task-start-orchestrator.js";
import { getMutationBlocked } from "../lib/task-mutation-guards.js";
import { canUserAccessRepository, canUserAccessTask, listTasksAccessibleToUser } from "../lib/task-ownership.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskQueueStore } from "../services/task-queue-store.js";
import type { TaskStore } from "../services/task-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { PersonalAccessTokenRuntimeContext } from "../services/personal-access-token-store.js";
import { resolveCreateTaskProviderConfig } from "../lib/task-create-defaults.js";
import { clampLimit, compactCheckpoint, compactMessage, compactRepository, compactRun, compactTask, detailTask } from "./format.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scopes: PermissionScope[];
  available?: (context: McpToolContext) => boolean;
  handler: (input: unknown, context: McpToolContext) => Promise<unknown>;
}

export interface McpToolContext {
  user: AuthSessionUser;
  deps: McpToolDeps;
  runtimeContext?: PersonalAccessTokenRuntimeContext | null;
}

export interface McpToolDeps {
  repositoryStore: RepositoryStore;
  settingsStore: SettingsStore;
  taskStore: TaskStore;
  taskQueueStore: TaskQueueStore;
  scheduler: SchedulerService;
  spawner: SpawnerService;
}

export class McpToolError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly reasonCode?: string
  ) {
    super(message);
  }
}

const taskActionSchema = z.enum(["build", "ask"]);

const listRepositoriesSchema = z.object({
  query: z.string().trim().optional(),
  limit: z.number().int().positive().max(100).optional()
});

const listTasksSchema = z.object({
  view: z.enum(["all", "active", "archived"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
  pinnedOnly: z.boolean().optional(),
  query: z.string().trim().optional()
});

const getTaskSchema = z.object({
  taskId: z.string().trim().min(1),
  include: z.array(z.enum(["messages", "runs", "checkpoints", "logs"])).optional()
});

const createTaskSchema = z
  .object({
    title: z.string().trim().min(1),
    repoId: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    draft: z.boolean().optional(),
    taskType: z.enum(["build", "ask"]).optional(),
    provider: z.enum(["codex", "claude"]).optional(),
    providerProfile: z.enum(["low", "medium", "high", "max"]).optional(),
    modelOverride: z.string().trim().min(1).optional(),
    baseBranch: z.string().trim().min(1).optional(),
    branchStrategy: z.enum(["feature_branch", "work_on_branch"]).optional()
  })
  .strict();

const createSubtaskSchema = createTaskSchema;

const updateDraftSchema = createTaskSchema.omit({ repoId: true, draft: true }).partial().extend({
  taskId: z.string().trim().min(1)
});

const startTaskSchema = z.object({
  taskId: z.string().trim().min(1),
  action: taskActionSchema.optional()
});

const addTaskMessageSchema = z.object({
  taskId: z.string().trim().min(1),
  content: z.string().trim().min(1),
  action: z.enum(["build", "ask", "comment"]).optional()
});

const linkPullRequestSchema = z.object({
  taskId: z.string().trim().min(1),
  prNumber: z.number().int().positive()
});

const linkIssueSchema = z.object({
  taskId: z.string().trim().min(1),
  issueNumber: z.number().int().positive()
});

const updateTaskConfigSchema = z.object({
  taskId: z.string().trim().min(1),
  autoApplyCheckpoints: z.boolean()
});

const replySlackThreadSchema = z.object({
  text: z.string().trim().min(1).max(4000)
});

const schemaToJson = (schema: z.ZodTypeAny): Record<string, unknown> => zodToJsonSchema(schema);

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // Minimal schema description for MCP clients; validation remains server-side via Zod.
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodTypeAny);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options };
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array" };
  }
  if (schema instanceof z.ZodNullable) {
    return { anyOf: [zodToJsonSchema(schema.unwrap()), { type: "null" }] };
  }
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }
  return {};
}

const requireScopes = (user: AuthSessionUser, scopes: PermissionScope[]): void => {
  const granted = new Set(user.scopes);
  const missing = scopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new McpToolError(403, "Forbidden", "missing_scope");
  }
};

const requireTaskCapability = (user: AuthSessionUser, action: TaskAction): void => {
  requireScopes(user, [getTaskCapabilityScopeForTaskAction(action)]);
};

const getAccessibleTask = async (context: McpToolContext, taskId: string): Promise<Task> => {
  const task = await context.deps.taskStore.getTask(taskId);
  if (!task || !canUserAccessTask(context.user, task)) {
    throw new McpToolError(404, "Task not found", "not_found");
  }
  return task;
};

const ensureNotArchived = (task: Task): void => {
  if (task.status === "archived") {
    throw new McpToolError(409, "Archived tasks are read-only", "archived");
  }
};

const startTask = async (context: McpToolContext, task: Task, action?: TaskAction): Promise<Task> => {
  ensureNotArchived(task);
  const resolvedAction = action ?? (task.taskType === "ask" ? "ask" : "build");
  requireTaskCapability(context.user, resolvedAction);

  const startTask =
    task.status === "draft"
      ? (await context.deps.taskStore.setStatus(task.id, "open", {
          executionStatus: "idle",
          executionAction: null,
          errorMessage: null,
          startedAt: null,
          finishedAt: null
        })) ?? task
      : task;

  const messages = await context.deps.taskStore.listMessages(task.id);
  const firstUserMessage = messages.find((message) => message.role === "user") ?? null;
  const result = await beginTaskStart(
    {
      taskStore: context.deps.taskStore,
      scheduler: context.deps.scheduler,
      spawner: context.deps.spawner
    },
    {
      task: startTask,
      action: resolvedAction,
      fallbackMessage: "Task start failed",
      input: {
        content: firstUserMessage?.content?.trim() || startTask.prompt,
        ...(firstUserMessage?.attachments && firstUserMessage.attachments.length > 0 ? { attachments: firstUserMessage.attachments } : {})
      }
    }
  );
  if (!result.ok) {
    throw new McpToolError(result.statusCode, result.message);
  }

  return result.task;
};

const createMcpTask = async (
  rawInput: unknown,
  context: McpToolContext,
  options: { parentTask?: Task | null } = {}
): Promise<Task> => {
  const input = createTaskSchema.parse(rawInput ?? {});
  const taskType = input.taskType ?? "build";
  requireScopes(context.user, [getTaskCapabilityScopeForTaskType(taskType)]);
  const repository = await context.deps.repositoryStore.getRepository(input.repoId);
  if (!repository || !canUserAccessRepository(context.user, repository.id)) {
    throw new McpToolError(404, "Repository not found", "not_found");
  }
  const parentTask = options.parentTask ?? null;
  if (parentTask && repository.id !== parentTask.repoId) {
    throw new McpToolError(404, "Repository not found", "not_found");
  }
  const settings = await context.deps.settingsStore.getSettings();
  const providerConfig = resolveCreateTaskProviderConfig(input, settings, repository, context.user);
  const task = await context.deps.taskStore.createTask(
    {
      ...input,
      ...providerConfig,
      draft: true,
      prompt: input.prompt,
      ...(parentTask
        ? {
            parentTaskId: parentTask.id,
            rootTaskId: parentTask.rootTaskId ?? parentTask.parentTaskId ?? parentTask.id
          }
        : {})
    },
    repository,
    context.user.id
  );
  await context.deps.taskStore.appendMessage(task.id, {
    role: "user",
    action: taskType === "ask" ? "ask" : "build",
    content: input.prompt
  });
  return (await context.deps.taskStore.getTask(task.id)) ?? task;
};

const postSlackThreadReply = async (input: {
  botToken: string | null | undefined;
  channelId: string;
  threadTs: string;
  text: string;
}): Promise<void> => {
  const botToken = input.botToken?.trim();
  if (!botToken) {
    throw new McpToolError(409, "Slack bot token is not configured in global settings.", "slack_bot_token_missing");
  }
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      channel: input.channelId,
      thread_ts: input.threadTs,
      text: input.text
    })
  });
  if (!response.ok) {
    throw new McpToolError(502, `Slack API returned HTTP ${response.status}`, "slack_api_error");
  }
  const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (body?.ok !== true) {
    throw new McpToolError(502, `Slack API rejected the reply${body?.error ? `: ${body.error}` : "."}`, "slack_api_error");
  }
};

export const createMcpTools = (): McpToolDefinition[] => [
  {
    name: "verft_list_repositories",
    description: "List repositories accessible to the authenticated user.",
    inputSchema: schemaToJson(listRepositoriesSchema),
    scopes: ["repo:list"],
    async handler(rawInput, context) {
      const input = listRepositoriesSchema.parse(rawInput ?? {});
      const query = input.query?.toLowerCase() ?? "";
      const limit = clampLimit(input.limit, 20, 100);
      const repositories = (await context.deps.repositoryStore.listRepositories())
        .filter((repository) => canUserAccessRepository(context.user, repository.id))
        .filter((repository) => !query || repository.name.toLowerCase().includes(query) || repository.url.toLowerCase().includes(query))
        .slice(0, limit)
        .map(compactRepository);
      return { repositories };
    }
  },
  {
    name: "verft_list_tasks",
    description: "List tasks accessible to the authenticated user.",
    inputSchema: schemaToJson(listTasksSchema),
    scopes: ["task:list", "task:read"],
    async handler(rawInput, context) {
      const input = listTasksSchema.parse(rawInput ?? {});
      const query = input.query?.toLowerCase() ?? "";
      const tasks = await listTasksAccessibleToUser(context.deps.taskStore, context.user, {
        view: input.view ?? "active",
        limit: 100
      });
      const filtered = tasks
        .filter((task) => canUserAccessTask(context.user, task))
        .filter((task) => (input.pinnedOnly ? task.pinned : true))
        .filter((task) => !query || task.title.toLowerCase().includes(query) || task.repoName.toLowerCase().includes(query))
        .slice(0, clampLimit(input.limit, 20, 100))
        .map(compactTask);
      return { tasks: filtered };
    }
  },
  {
    name: "verft_get_task",
    description: "Get task detail and optional bounded related records.",
    inputSchema: schemaToJson(getTaskSchema),
    scopes: ["task:read"],
    async handler(rawInput, context) {
      const input = getTaskSchema.parse(rawInput ?? {});
      const task = await getAccessibleTask(context, input.taskId);
      const include = new Set(input.include ?? []);
      const result: Record<string, unknown> = { task: detailTask(task) };
      if (include.has("messages")) {
        const messages = await context.deps.taskStore.listMessages(task.id);
        result.messages = messages.slice(-20).map(compactMessage);
      }
      if (include.has("runs")) {
        const runs = await context.deps.taskStore.listRuns(task.id);
        result.runs = runs.slice(-10).map(compactRun);
      }
      if (include.has("checkpoints")) {
        const checkpoints = await context.deps.taskStore.listChangeProposals(task.id);
        result.checkpoints = checkpoints.slice(-10).map(compactCheckpoint);
      }
      if (include.has("logs")) {
        result.logs = task.logs.slice(-100);
      }
      return result;
    }
  },
  {
    name: "verft_create_task",
    description: "Create a draft task by default. Set draft=false to create and start it.",
    inputSchema: schemaToJson(createTaskSchema),
    scopes: ["task:create", "repo:list"],
    async handler(rawInput, context) {
      const input = createTaskSchema.parse(rawInput ?? {});
      const created = await createMcpTask(rawInput, context);
      if (input.draft === false) {
        return { task: compactTask(await startTask(context, created)) };
      }
      return { task: compactTask(created) };
    }
  },
  {
    name: "verft_create_subtask",
    description:
      "Create a child task from inside the current task runtime. The target repository must match the current runtime task repository.",
    inputSchema: schemaToJson(createSubtaskSchema),
    scopes: ["task:create_subtask", "repo:list"],
    available(context) {
      return typeof context.runtimeContext?.taskId === "string" && context.runtimeContext.taskId.trim().length > 0;
    },
    async handler(rawInput, context) {
      const input = createSubtaskSchema.parse(rawInput ?? {});
      const runtimeTaskId = context.runtimeContext?.taskId?.trim();
      if (!runtimeTaskId) {
        throw new McpToolError(404, "Subtask creation is only available inside a task runtime.", "runtime_context_missing");
      }
      const parentTask = await getAccessibleTask(context, runtimeTaskId);
      const created = await createMcpTask(rawInput, context, { parentTask });
      if (input.draft === false) {
        const started = await startTask(context, created);
        return {
          task: compactTask(started),
          parentTaskId: parentTask.id,
          rootTaskId: parentTask.rootTaskId ?? parentTask.parentTaskId ?? parentTask.id
        };
      }
      return {
        task: compactTask(created),
        parentTaskId: parentTask.id,
        rootTaskId: parentTask.rootTaskId ?? parentTask.parentTaskId ?? parentTask.id
      };
    }
  },
  {
    name: "verft_update_draft",
    description: "Update a draft task definition.",
    inputSchema: schemaToJson(updateDraftSchema),
    scopes: ["task:edit"],
    async handler(rawInput, context) {
      const input = updateDraftSchema.parse(rawInput ?? {});
      const task = await getAccessibleTask(context, input.taskId);
      if (task.status !== "draft") {
        throw new McpToolError(409, "Only draft tasks can be updated with this tool.", "not_draft");
      }
      const providerConfig = {
        provider: input.provider ?? task.provider,
        providerProfile: input.providerProfile ?? task.providerProfile,
        modelOverride: input.modelOverride ?? task.modelOverride ?? undefined
      };
      const updated = await context.deps.taskStore.patchTask(task.id, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.taskType !== undefined ? { taskType: input.taskType, lastAction: input.taskType === "ask" ? "ask" : "build" } : {}),
        ...(input.baseBranch !== undefined ? { baseBranch: input.baseBranch } : {}),
        ...(input.branchStrategy !== undefined ? { branchStrategy: input.branchStrategy } : {}),
        provider: providerConfig.provider,
        providerProfile: providerConfig.providerProfile,
        modelOverride: providerConfig.modelOverride
      });
      return { task: compactTask(updated ?? task) };
    }
  },
  {
    name: "verft_start_task",
    description: "Start a draft/open task.",
    inputSchema: schemaToJson(startTaskSchema),
    scopes: ["task:edit"],
    async handler(rawInput, context) {
      const input = startTaskSchema.parse(rawInput ?? {});
      const task = await getAccessibleTask(context, input.taskId);
      return { task: compactTask(await startTask(context, task, input.action)) };
    }
  },
  {
    name: "verft_add_task_message",
    description: "Add a comment or build/ask follow-up to a task.",
    inputSchema: schemaToJson(addTaskMessageSchema),
    scopes: ["task:edit"],
    async handler(rawInput, context) {
      const input = addTaskMessageSchema.parse(rawInput ?? {});
      const task = await getAccessibleTask(context, input.taskId);
      ensureNotArchived(task);
      const action = input.action ?? (task.taskType === "ask" ? "ask" : "build");
      if (action !== "comment") {
        requireTaskCapability(context.user, action);
        const blocked = await getMutationBlocked(context.deps.taskStore, task.id);
        if (blocked?.code === "active_terminal_session") {
          throw new McpToolError(409, blocked.message, blocked.code);
        }
      }
      const hasOlderPendingActionMessages = action !== "comment" ? await context.deps.taskStore.hasPendingActionMessage(task.id) : false;
      const isBusy =
        task.executionStatus === "queued" ||
        task.executionStatus === "preparing" ||
        task.executionStatus === "running";
      const message = await context.deps.taskStore.appendMessage(task.id, {
        role: "user",
        action,
        content: input.content,
        ...(action !== "comment" ? { queueState: "pending" as const, queueSource: "user" as const } : {})
      });
      if (action !== "comment") {
        if (task.executionStatus === "idle" && !isBusy && !hasOlderPendingActionMessages && !(await context.deps.taskStore.hasPendingChangeProposal(task.id)) && message) {
          await context.deps.scheduler.triggerAction(task.id, action, { content: input.content }, { promptMessageId: message.id });
        } else if ((task.executionStatus === "failed" || task.executionStatus === "cancelled") && !(await context.deps.taskStore.hasPendingChangeProposal(task.id))) {
          await context.deps.scheduler.triggerNextPendingAction(task.id, "manual");
        }
      }
      return { task: compactTask((await context.deps.taskStore.getTask(task.id)) ?? task), messageId: message?.id ?? null };
    }
  },
  {
    name: "verft_link_pull_request",
    description: "Link a task to a GitHub pull request number after creating the PR with GitHub MCP.",
    inputSchema: schemaToJson(linkPullRequestSchema),
    scopes: ["task:edit"],
    async handler(rawInput, context) {
      const input = linkPullRequestSchema.parse(rawInput ?? {});
      const task = await getAccessibleTask(context, input.taskId);
      ensureNotArchived(task);
      const updated = await context.deps.taskStore.patchTask(task.id, {
        githubPrNumber: input.prNumber
      });
      return { task: compactTask(updated ?? task), githubPrNumber: input.prNumber };
    }
  },
  {
    name: "verft_link_issue",
    description: "Link a task to a GitHub issue number.",
    inputSchema: schemaToJson(linkIssueSchema),
    scopes: ["task:edit"],
    async handler(rawInput, context) {
      const input = linkIssueSchema.parse(rawInput ?? {});
      const task = await getAccessibleTask(context, input.taskId);
      ensureNotArchived(task);
      const updated = await context.deps.taskStore.patchTask(task.id, {
        githubIssueNumber: input.issueNumber
      });
      return { task: compactTask(updated ?? task), githubIssueNumber: input.issueNumber };
    }
  },
  {
    name: "verft_reply_slack_thread",
    description: "Reply to the Slack thread linked to the current Verft task. This tool is only available inside a Slack-linked task run.",
    inputSchema: schemaToJson(replySlackThreadSchema),
    scopes: ["task:edit"],
    available(context) {
      return typeof context.runtimeContext?.taskId === "string" && context.runtimeContext.taskId.trim().length > 0;
    },
    async handler(rawInput, context) {
      const input = replySlackThreadSchema.parse(rawInput ?? {});
      const taskId = context.runtimeContext?.taskId?.trim();
      if (!taskId) {
        throw new McpToolError(404, "Slack reply tool is only available inside a task runtime.", "runtime_context_missing");
      }
      const task = await getAccessibleTask(context, taskId);
      if (!task.slackChannelId || !task.slackThreadTs) {
        throw new McpToolError(409, "This task is not linked to a Slack thread.", "slack_thread_not_linked");
      }
      const credentials = await context.deps.settingsStore.getRuntimeCredentials();
      await postSlackThreadReply({
        botToken: credentials.slackBotToken,
        channelId: task.slackChannelId,
        threadTs: task.slackThreadTs,
        text: input.text
      });
      return {
        ok: true,
        channelId: task.slackChannelId,
        threadTs: task.slackThreadTs
      };
    }
  },
  {
    name: "verft_update_task_config",
    description: "Update Phase 1 MCP-safe task configuration: auto-apply checkpoints.",
    inputSchema: schemaToJson(updateTaskConfigSchema),
    scopes: ["task:edit"],
    async handler(rawInput, context) {
      const input = updateTaskConfigSchema.parse(rawInput ?? {});
      const task = await getAccessibleTask(context, input.taskId);
      ensureNotArchived(task);
      const updated = await context.deps.taskStore.patchTask(task.id, {
        autoApplyCheckpoints: input.autoApplyCheckpoints
      });
      return { task: compactTask(updated ?? task) };
    }
  }
];
