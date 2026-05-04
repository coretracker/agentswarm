import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { applyTaskStartMode } from "../lib/task-start-mode.js";
import { canUserAccessRepository, canUserAccessTask, isAdminUser } from "../lib/task-ownership.js";
import { appendSlackEventLog } from "../lib/slack-event-log.js";
import { getTaskStatusLabel, type AgentProvider, type CodexCredentialSource, type ProviderProfile, type TaskStartMode, type TaskType } from "@agentswarm/shared-types";
import { normalizeProvider } from "../lib/provider-config.js";
import type { RepositoryStore } from "../services/repository-store.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { SettingsStore } from "../services/settings-store.js";
import type { SlackTaskWorkflowService } from "../services/slack-task-workflow-service.js";
import type { SpawnerService } from "../services/spawner.js";
import type { TaskStore } from "../services/task-store.js";
import type { UserStore } from "../services/user-store.js";

type SlackCommandBody = {
  command?: string;
  text?: string;
  user_id?: string;
  team_id?: string;
  channel_id?: string;
  response_url?: string;
  trigger_id?: string;
};

type SlackInteractionBody = {
  payload?: string;
};

type SlackInteractionPayload = {
  type?: string;
  user?: {
    id?: string;
  };
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, unknown>>;
    };
  };
};

type SlackParsedCommand =
  | { kind: "help" }
  | { kind: "task"; taskId: string }
  | {
      kind: "new";
      repoId: string | null;
      title: string | null;
      prompt: string;
      taskType: TaskType;
      startMode: TaskStartMode;
      provider: AgentProvider | null;
      providerProfile: ProviderProfile | null;
      modelOverride: string | null;
      codexCredentialSource: CodexCredentialSource | null;
    };

type SlackNewTaskModalMetadata = {
  responseUrl: string;
  teamId: string | null;
  channelId: string | null;
};

type SlackRepositoryOption = {
  id: string;
  name: string;
};

const slackCommandBodySchema = z.object({
  command: z.string().trim().min(1),
  text: z.string().optional().default(""),
  user_id: z.string().trim().min(1),
  team_id: z.string().trim().min(1).optional(),
  channel_id: z.string().trim().min(1).optional(),
  response_url: z.string().trim().optional(),
  trigger_id: z.string().trim().optional()
});

const slackInteractionBodySchema = z.object({
  payload: z.string().trim().min(1)
});

const SLACK_SIGNATURE_VERSION = "v0";
const SLACK_REQUEST_MAX_AGE_SECONDS = 60 * 5;
const SLACK_NEW_TASK_CALLBACK_ID = "agentswarm_new_task";
const SLACK_MODAL_REPO_BLOCK_ID = "repo";
const SLACK_MODAL_TITLE_BLOCK_ID = "title";
const SLACK_MODAL_PROMPT_BLOCK_ID = "prompt";
const SLACK_MODAL_TASK_TYPE_BLOCK_ID = "task_type";
const SLACK_MODAL_START_MODE_BLOCK_ID = "start_mode";
const SLACK_MODAL_PROVIDER_BLOCK_ID = "provider";
const SLACK_MODAL_MODEL_BLOCK_ID = "model";
const SLACK_MODAL_EFFORT_BLOCK_ID = "effort";
const SLACK_MODAL_CREDENTIALS_BLOCK_ID = "credentials";

const trimSlackValue = (value: string | undefined | null): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const stripLeadingCommandWord = (value: string, command: "new" | "create"): string => {
  const pattern = new RegExp(`^${command}\\s+`, "i");
  if (pattern.test(value)) {
    return value.replace(pattern, "");
  }

  return "";
};

const buildTaskLink = (taskId: string): string | null => {
  const base = env.CORS_ORIGIN.trim().replace(/\/+$/, "");
  if (!base) {
    return null;
  }

  return `${base}/tasks/${encodeURIComponent(taskId)}`;
};

const summarizePrompt = (prompt: string): string => {
  const normalized = normalizeWhitespace(prompt);
  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77).trimEnd()}...`;
};

const truncateSlackText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
};

const buildSlackOption = (label: string, value: string): { text: { type: "plain_text"; text: string; emoji: true }; value: string } => ({
  text: {
    type: "plain_text",
    text: truncateSlackText(label, 75),
    emoji: true
  },
  value
});

const buildSlackInitialOption = (
  options: Array<{ text: { type: "plain_text"; text: string; emoji: true }; value: string }>,
  value: string | null | undefined
): { text: { type: "plain_text"; text: string; emoji: true }; value: string } | undefined => {
  const trimmedValue = value?.trim() ?? "";
  if (!trimmedValue) {
    return undefined;
  }

  return options.find((option) => option.value === trimmedValue);
};

const buildSlackStaticSelectElement = (
  options: Array<{ text: { type: "plain_text"; text: string; emoji: true }; value: string }>,
  initialValue: string | null
): Record<string, unknown> => ({
  type: "static_select",
  action_id: "value",
  placeholder: {
    type: "plain_text",
    text: "Select an option"
  },
  options,
  ...(buildSlackInitialOption(options, initialValue) ? { initial_option: buildSlackInitialOption(options, initialValue) } : {})
});

const buildSlackSelectFieldBlock = (input: {
  blockId: string;
  label: string;
  options: Array<{ text: { type: "plain_text"; text: string; emoji: true }; value: string }>;
  initialValue: string | null;
}): Record<string, unknown> => ({
  type: "input",
  block_id: input.blockId,
  label: {
    type: "plain_text",
    text: input.label
  },
  element: buildSlackStaticSelectElement(input.options, input.initialValue)
});

const buildSlackTextFieldBlock = (input: {
  blockId: string;
  label: string;
  initialValue: string | null;
  multiline?: boolean;
  placeholder?: string;
}): Record<string, unknown> => ({
  type: "input",
  block_id: input.blockId,
  label: {
    type: "plain_text",
    text: input.label
  },
  element: {
    type: "plain_text_input",
    action_id: "value",
    ...(input.multiline ? { multiline: true } : {}),
    ...(input.placeholder ? { placeholder: { type: "plain_text", text: input.placeholder } } : {}),
    ...(input.initialValue ? { initial_value: input.initialValue } : {})
  }
});

const buildSlackTaskTypeOptions = (): Array<{ text: { type: "plain_text"; text: string; emoji: true }; value: string }> => [
  buildSlackOption("Build", "build"),
  buildSlackOption("Ask", "ask")
];

const buildSlackStartModeOptions = (): Array<{ text: { type: "plain_text"; text: string; emoji: true }; value: string }> => [
  buildSlackOption("Run now", "run_now"),
  buildSlackOption("Prepare workspace", "prepare_workspace"),
  buildSlackOption("Idle", "idle")
];

const buildSlackProviderOptions = (): Array<{ text: { type: "plain_text"; text: string; emoji: true }; value: string }> => [
  buildSlackOption("Codex", "codex"),
  buildSlackOption("Claude", "claude")
];

const buildSlackEffortOptions = (): Array<{ text: { type: "plain_text"; text: string; emoji: true }; value: string }> => [
  buildSlackOption("Low", "low"),
  buildSlackOption("Medium", "medium"),
  buildSlackOption("High", "high"),
  buildSlackOption("Max", "max")
];

const buildSlackCredentialOptions = (): Array<{ text: { type: "plain_text"; text: string; emoji: true }; value: string }> => [
  buildSlackOption("Auto", "auto"),
  buildSlackOption("Profile", "profile"),
  buildSlackOption("Global", "global")
];

const buildSlackRepositoryOptions = (repositories: SlackRepositoryOption[]): Array<{ text: { type: "plain_text"; text: string; emoji: true }; value: string }> =>
  repositories.slice(0, 100).map((repository) => buildSlackOption(`${repository.name} (${repository.id})`, repository.id));

const buildSlackNewTaskModal = (input: {
  responseUrl: string;
  teamId: string | null;
  channelId: string | null;
  repositories: SlackRepositoryOption[];
  initialRepositoryId: string | null;
  initialTitle: string | null;
  initialPrompt: string | null;
  initialTaskType: TaskType;
  initialStartMode: TaskStartMode;
  initialProvider: AgentProvider;
  initialModel: string;
  initialEffort: ProviderProfile;
  initialCredentialSource: CodexCredentialSource;
}): Record<string, unknown> => {
  const repositoryOptions = buildSlackRepositoryOptions(input.repositories);
  const repoBlock =
    repositoryOptions.length > 0 && input.repositories.length <= 100
      ? buildSlackSelectFieldBlock({
          blockId: SLACK_MODAL_REPO_BLOCK_ID,
          label: "Repository",
          options: repositoryOptions,
          initialValue: input.initialRepositoryId
        })
      : buildSlackTextFieldBlock({
          blockId: SLACK_MODAL_REPO_BLOCK_ID,
          label: "Repository ID",
          initialValue: input.initialRepositoryId,
          placeholder: "Enter the repository id"
        });

  return {
    type: "modal",
    callback_id: SLACK_NEW_TASK_CALLBACK_ID,
    private_metadata: JSON.stringify({
      responseUrl: input.responseUrl,
      teamId: input.teamId,
      channelId: input.channelId
    }),
    title: {
      type: "plain_text",
      text: "New AgentSwarm task"
    },
    submit: {
      type: "plain_text",
      text: "Create task"
    },
    close: {
      type: "plain_text",
      text: "Cancel"
    },
    blocks: [
      repoBlock,
      buildSlackTextFieldBlock({
        blockId: SLACK_MODAL_TITLE_BLOCK_ID,
        label: "Title",
        initialValue: input.initialTitle ?? null,
        placeholder: "Short task title"
      }),
      buildSlackTextFieldBlock({
        blockId: SLACK_MODAL_PROMPT_BLOCK_ID,
        label: "Prompt",
        initialValue: input.initialPrompt ?? null,
        multiline: true,
        placeholder: "What should the agent do?"
      }),
      buildSlackSelectFieldBlock({
        blockId: SLACK_MODAL_TASK_TYPE_BLOCK_ID,
        label: "Task type",
        options: buildSlackTaskTypeOptions(),
        initialValue: input.initialTaskType
      }),
      buildSlackSelectFieldBlock({
        blockId: SLACK_MODAL_START_MODE_BLOCK_ID,
        label: "Start mode",
        options: buildSlackStartModeOptions(),
        initialValue: input.initialStartMode
      }),
      buildSlackSelectFieldBlock({
        blockId: SLACK_MODAL_PROVIDER_BLOCK_ID,
        label: "Provider",
        options: buildSlackProviderOptions(),
        initialValue: input.initialProvider
      }),
      buildSlackTextFieldBlock({
        blockId: SLACK_MODAL_MODEL_BLOCK_ID,
        label: "Model",
        initialValue: input.initialModel,
        placeholder: "Optional model override"
      }),
      buildSlackSelectFieldBlock({
        blockId: SLACK_MODAL_EFFORT_BLOCK_ID,
        label: "Effort",
        options: buildSlackEffortOptions(),
        initialValue: input.initialEffort
      }),
      buildSlackSelectFieldBlock({
        blockId: SLACK_MODAL_CREDENTIALS_BLOCK_ID,
        label: "Credentials",
        options: buildSlackCredentialOptions(),
        initialValue: input.initialCredentialSource
      })
    ]
  };
};

const parseSlackCommandText = (text: string): SlackParsedCommand => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: "help" };
  }

  const lower = trimmed.toLowerCase();
  if (lower === "help") {
    return { kind: "help" };
  }

  if (lower === "task" || lower.startsWith("task ")) {
    const taskId = trimSlackValue(trimmed.slice(4)) ?? "";
    if (!taskId) {
      return { kind: "help" };
    }

    return { kind: "task", taskId };
  }

  if (lower === "new" || lower.startsWith("new ") || lower === "create" || lower.startsWith("create ")) {
    const payloadText = lower.startsWith("new ")
      ? stripLeadingCommandWord(trimmed, "new")
      : lower.startsWith("create ")
        ? stripLeadingCommandWord(trimmed, "create")
        : "";
    const tokenPattern =
      /(^|\s)(repo|repoId|title|prompt|type|mode|provider|model|effort|credentials|codexCredentialSource|providerProfile|profile|reasoningEffort)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/gi;
    const extracted: {
      repoId: string | null;
      title: string | null;
      prompt: string | null;
      taskType: TaskType;
      startMode: TaskStartMode;
      provider: AgentProvider | null;
      providerProfile: ProviderProfile | null;
      modelOverride: string | null;
      codexCredentialSource: CodexCredentialSource | null;
    } = {
      repoId: null,
      title: null,
      prompt: null,
      taskType: "build",
      startMode: "run_now",
      provider: null,
      providerProfile: null,
      modelOverride: null,
      codexCredentialSource: null
    };

    const stripped = payloadText.replace(tokenPattern, (_match, prefix: string, key: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
      const value = trimSlackValue(doubleQuoted ?? singleQuoted ?? bare) ?? "";
      switch (key.toLowerCase()) {
        case "repo":
        case "repoid":
          extracted.repoId = value;
          break;
        case "title":
          extracted.title = value;
          break;
        case "prompt":
          extracted.prompt = value;
          break;
        case "type":
          extracted.taskType = value === "ask" ? "ask" : "build";
          break;
        case "mode":
          extracted.startMode =
            value === "idle" || value === "prepare_workspace" ? value : "run_now";
          break;
        case "provider":
          extracted.provider = value === "claude" || value === "codex" ? value : null;
          break;
        case "model":
          extracted.modelOverride = value;
          break;
        case "effort":
        case "providerprofile":
        case "profile":
          extracted.providerProfile =
            value === "low" || value === "medium" || value === "high" || value === "max"
              ? value
              : value === "minimal"
                ? "low"
                : value === "xhigh"
                  ? "high"
                  : null;
          break;
        case "credentials":
        case "codexcredentialsource":
          extracted.codexCredentialSource =
            value === "auto" || value === "profile" || value === "global" ? value : null;
          break;
        case "reasoningeffort":
          extracted.providerProfile =
            value === "minimal" || value === "low"
              ? "low"
              : value === "medium"
                ? "medium"
                : value === "high" || value === "xhigh"
                  ? "high"
                  : null;
          break;
      }

      return prefix || " ";
    });

    const leftover = normalizeWhitespace(stripped);
    if (!extracted.prompt && leftover) {
      extracted.prompt = leftover;
    }

    return {
      kind: "new",
      repoId: extracted.repoId,
      title: extracted.title,
      prompt: extracted.prompt ?? "",
      taskType: extracted.taskType,
      startMode: extracted.startMode,
      provider: extracted.provider,
      providerProfile: extracted.providerProfile,
      modelOverride: extracted.modelOverride,
      codexCredentialSource: extracted.codexCredentialSource
    };
  }

  return { kind: "help" };
};

const parseSlackRequest = (body: unknown): SlackCommandBody | null => {
  if (!body || typeof body !== "object") {
    return null;
  }

  const parsed = slackCommandBodySchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

const verifySlackSignature = (signingSecret: string, request: FastifyRequest): boolean => {
  const requestTimestamp = request.headers["x-slack-request-timestamp"];
  const requestSignature = request.headers["x-slack-signature"];
  const rawBody = request.rawBody ?? "";

  if (typeof requestTimestamp !== "string" || typeof requestSignature !== "string" || !rawBody) {
    return false;
  }

  const timestamp = Number(requestTimestamp);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > SLACK_REQUEST_MAX_AGE_SECONDS) {
    return false;
  }

  const baseString = `${SLACK_SIGNATURE_VERSION}:${requestTimestamp}:${rawBody}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac("sha256", signingSecret).update(baseString).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(requestSignature, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
};

const fetchSlackUserEmail = async (botToken: string, slackUserId: string): Promise<string | null> => {
  const response = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
    headers: {
      Authorization: `Bearer ${botToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Slack user lookup failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    user?: {
      deleted?: boolean;
      profile?: {
        email?: string;
      };
    };
  };

  if (!data.ok) {
    throw new Error(data.error ? `Slack user lookup failed: ${data.error}` : "Slack user lookup failed");
  }

  const email = trimSlackValue(data.user?.profile?.email);
  return email ?? null;
};

const postSlackResponse = async (responseUrl: string, text: string): Promise<void> => {
  const response = await fetch(responseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      response_type: "ephemeral",
      text
    })
  });

  if (!response.ok) {
    throw new Error(`Slack response delivery failed with HTTP ${response.status}`);
  }
};

const openSlackModal = async (botToken: string, triggerId: string, view: Record<string, unknown>): Promise<void> => {
  const response = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      trigger_id: triggerId,
      view
    })
  });

  if (!response.ok) {
    throw new Error(`Slack modal open failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!data.ok) {
    throw new Error(data.error ? `Slack modal open failed: ${data.error}` : "Slack modal open failed");
  }
};

const parseSlackModalMetadata = (value: string | undefined): SlackNewTaskModalMetadata | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<SlackNewTaskModalMetadata>;
    const responseUrl = typeof parsed.responseUrl === "string" ? parsed.responseUrl.trim() : "";
    if (!responseUrl) {
      return null;
    }

    return {
      responseUrl,
      teamId: typeof parsed.teamId === "string" && parsed.teamId.trim().length > 0 ? parsed.teamId.trim() : null,
      channelId: typeof parsed.channelId === "string" && parsed.channelId.trim().length > 0 ? parsed.channelId.trim() : null
    };
  } catch {
    return null;
  }
};

const getSlackInputValue = (field: unknown): string | null => {
  if (!field || typeof field !== "object") {
    return null;
  }

  const candidate = field as {
    value?: unknown;
    selected_option?: {
      value?: unknown;
    };
  };

  if (typeof candidate.value === "string") {
    return trimSlackValue(candidate.value);
  }

  const selectedValue = candidate.selected_option?.value;
  if (typeof selectedValue === "string") {
    return trimSlackValue(selectedValue);
  }

  return null;
};

const buildHelpMessage = (): string => {
  return [
    "Use `/agentswarm new` to open the task form. Optional prefills: `repo=<repoId> prompt=<task description> [title=<short title>] [type=build|ask] [mode=run_now|prepare_workspace|idle] [provider=codex|claude] [model=<model>] [effort=low|medium|high|max] [credentials=auto|profile|global]`.",
    "Use `/agentswarm task <id>` to inspect a task you can access.",
    "In the task thread, use `build` or `ask` to run follow-ups, `build mode` / `ask mode` to switch task mode, `config taskType=build provider=claude model=... effort=...`, `accept`, `reject`, `archive`, or `delete`.",
    "If you have exactly one repository assigned in AgentSwarm, `repo=<repoId>` can be omitted."
  ].join("\n");
};

const formatTaskDetails = (task: Awaited<ReturnType<TaskStore["getTask"]>>, link: string | null): string => {
  if (!task) {
    return "Task not found.";
  }

  return [
    `Task: ${task.title}`,
    `Id: ${task.id}`,
    `Status: ${getTaskStatusLabel(task.status)}`,
    `Type: ${task.taskType}`,
    `Repository: ${task.repoName}`,
    link ? `Open: ${link}` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};

const buildNotFoundMessage = (): string =>
  "No matching active AgentSwarm account was found for this Slack user email.";

export const registerSlackRoutes = (
  app: FastifyInstance,
  deps: {
    settingsStore: SettingsStore;
    userStore: UserStore;
    repositoryStore: RepositoryStore;
    taskStore: TaskStore;
    scheduler: SchedulerService;
    spawner: SpawnerService;
    workflowService: SlackTaskWorkflowService;
  }
): void => {
  app.post<{ Body: SlackCommandBody | Record<string, string> }>("/slack/commands", async (request, reply) => {
    const runtimeCredentials = await deps.settingsStore.getRuntimeCredentials();
    if (!runtimeCredentials.slackBotToken || !runtimeCredentials.slackSigningSecret) {
      void appendSlackEventLog("slash_command:missing_credentials", {});
      return reply.status(503).send({
        response_type: "ephemeral",
        text: "Slack integration is not configured in AgentSwarm Settings."
      });
    }

    if (!verifySlackSignature(runtimeCredentials.slackSigningSecret, request)) {
      void appendSlackEventLog("slash_command:invalid_signature", {});
      return reply.status(401).send({
        response_type: "ephemeral",
        text: "Invalid Slack signature."
      });
    }

    const parsedBody = parseSlackRequest(request.body);
    if (!parsedBody) {
      void appendSlackEventLog("slash_command:invalid_payload", {
        bodyKeys: request.body && typeof request.body === "object" ? Object.keys(request.body as Record<string, unknown>) : null
      });
      return reply.status(400).send({
        response_type: "ephemeral",
        text: "Invalid Slack command payload."
      });
    }

    void appendSlackEventLog("slash_command", {
      command: parsedBody.command,
      userId: parsedBody.user_id,
      teamId: parsedBody.team_id ?? null,
      channelId: parsedBody.channel_id ?? null,
      textPreview: (parsedBody.text ?? "").slice(0, 200)
    });

    if (parsedBody.command !== "/agentswarm") {
      return reply.status(400).send({
        response_type: "ephemeral",
        text: "Unknown Slack command."
      });
    }

    if (!parsedBody.response_url) {
      return reply.status(400).send({
        response_type: "ephemeral",
        text: "Missing Slack response URL."
      });
    }

    const command = parseSlackCommandText(parsedBody.text ?? "");
    const responseUrl = parsedBody.response_url;

    if (command.kind === "help") {
      await postSlackResponse(responseUrl, buildHelpMessage()).catch((postError) => {
        request.log.error({ error: postError }, "Failed to deliver Slack help response");
      });
      return;
    }

    if (command.kind === "task") {
      const slackEmail = await fetchSlackUserEmail(runtimeCredentials.slackBotToken, parsedBody.user_id);
      if (!slackEmail) {
        return reply.send({
          response_type: "ephemeral",
          text: "Could not read the Slack user's email address."
        });
      }

      const matchedUser = await deps.userStore.getUserByEmail(slackEmail);
      if (!matchedUser || !matchedUser.active) {
        return reply.send({
          response_type: "ephemeral",
          text: buildNotFoundMessage()
        });
      }

      const task = await deps.taskStore.getTask(command.taskId);
      if (!task || !canUserAccessTask(matchedUser, task)) {
        return reply.send({
          response_type: "ephemeral",
          text: "Task not found or not accessible."
        });
      }

      await postSlackResponse(responseUrl, formatTaskDetails(task, buildTaskLink(task.id))).catch((postError) => {
        request.log.error({ error: postError }, "Failed to deliver Slack task response");
      });
      return;
    }

    if (!parsedBody.trigger_id) {
      return reply.status(400).send({
        response_type: "ephemeral",
        text: "Missing Slack trigger ID."
      });
    }

    const slackEmail = await fetchSlackUserEmail(runtimeCredentials.slackBotToken, parsedBody.user_id);
    if (!slackEmail) {
      return reply.send({
        response_type: "ephemeral",
        text: "Could not read the Slack user's email address."
      });
    }

    const matchedUser = await deps.userStore.getUserByEmail(slackEmail);
    if (!matchedUser || !matchedUser.active) {
      return reply.send({
        response_type: "ephemeral",
        text: buildNotFoundMessage()
      });
    }

    const commandText = command.kind === "new" ? command : null;
    const settings = await deps.settingsStore.getSettings();
    const provider = normalizeProvider(commandText?.provider ?? settings.defaultProvider);
    const providerProfile =
      commandText?.providerProfile ??
      (provider === "claude" ? settings.claudeDefaultEffort : settings.codexDefaultEffort);
    const initialModel = commandText?.modelOverride?.trim() || (provider === "claude" ? settings.claudeDefaultModel : settings.codexDefaultModel);
    const initialTaskTitle =
      normalizeWhitespace(commandText?.title ?? "") || summarizePrompt(commandText?.prompt ?? "");

    const accessibleRepositoryRecords = isAdminUser(matchedUser)
      ? await deps.repositoryStore.listRepositories()
      : await Promise.all(
          matchedUser.repositoryIds.map(async (repoId) => {
            const repository = await deps.repositoryStore.getRepository(repoId);
            return repository;
          })
        );
    const accessibleRepositories: SlackRepositoryOption[] = accessibleRepositoryRecords
      .filter((repository): repository is NonNullable<typeof repository> => Boolean(repository))
      .map((repository) => ({
        id: repository.id,
        name: repository.name
      }));

    if (accessibleRepositories.length === 0) {
      return reply.send({
        response_type: "ephemeral",
        text: "No repositories are currently assigned to your AgentSwarm account."
      });
    }

    const initialRepositoryId =
      commandText?.repoId?.trim() ||
      (accessibleRepositories.length === 1 ? accessibleRepositories[0]?.id ?? null : null);

    if (initialRepositoryId && !accessibleRepositories.some((repository) => repository.id === initialRepositoryId)) {
      return reply.send({
        response_type: "ephemeral",
        text: "That repository is not available to your AgentSwarm account."
      });
    }

    const initialTaskType = commandText?.taskType ?? "build";
    const initialStartMode = commandText?.startMode ?? "run_now";
    const initialCredentialSource = commandText?.codexCredentialSource ?? "auto";
    try {
      await openSlackModal(
        runtimeCredentials.slackBotToken,
        parsedBody.trigger_id,
        buildSlackNewTaskModal({
          responseUrl,
          teamId: parsedBody.team_id ?? null,
          channelId: parsedBody.channel_id ?? null,
          repositories: accessibleRepositories,
          initialRepositoryId,
          initialTitle: initialTaskTitle || null,
          initialPrompt: commandText?.prompt ? normalizeWhitespace(commandText.prompt) : null,
          initialTaskType,
          initialStartMode,
          initialProvider: provider,
          initialModel,
          initialEffort: providerProfile,
          initialCredentialSource
        })
      );
    } catch (error) {
      request.log.error({ error }, "Failed to open Slack modal");
      return reply.status(502).send({
        response_type: "ephemeral",
        text: "Could not open the Slack form."
      });
    }

    return reply.send();
  });

  app.post<{ Body: SlackInteractionBody | Record<string, string> }>("/slack/interactions", async (request, reply) => {
    const runtimeCredentials = await deps.settingsStore.getRuntimeCredentials();
    if (!runtimeCredentials.slackBotToken || !runtimeCredentials.slackSigningSecret) {
      void appendSlackEventLog("interaction:missing_credentials", {});
      return reply.status(503).send({
        response_action: "errors",
        errors: {},
        text: "Slack integration is not configured in AgentSwarm Settings."
      });
    }

    if (!verifySlackSignature(runtimeCredentials.slackSigningSecret, request)) {
      void appendSlackEventLog("interaction:invalid_signature", {});
      return reply.status(401).send({
        response_action: "errors",
        errors: {},
        text: "Invalid Slack signature."
      });
    }

    const parsedBody = slackInteractionBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      void appendSlackEventLog("interaction:invalid_payload", {
        bodyKeys: request.body && typeof request.body === "object" ? Object.keys(request.body as Record<string, unknown>) : null
      });
      return reply.status(400).send({
        response_action: "errors",
        errors: {},
        text: "Invalid Slack interaction payload."
      });
    }

    let payload: SlackInteractionPayload;
    try {
      payload = JSON.parse(parsedBody.data.payload) as SlackInteractionPayload;
    } catch {
      void appendSlackEventLog("interaction:invalid_json", {});
      return reply.status(400).send({
        response_action: "errors",
        errors: {},
        text: "Invalid Slack interaction payload."
      });
    }

    void appendSlackEventLog("interaction", {
      type: payload.type ?? null,
      callbackId: payload.view?.callback_id ?? null,
      userId: payload.user?.id ?? null
    });

    if (payload.type !== "view_submission" || payload.view?.callback_id !== SLACK_NEW_TASK_CALLBACK_ID) {
      return reply.status(400).send({
        response_action: "errors",
        errors: {},
        text: "Unknown Slack interaction."
      });
    }

    const metadata = parseSlackModalMetadata(payload.view.private_metadata);
    if (!metadata) {
      return reply.status(400).send({
        response_action: "errors",
        errors: {},
        text: "Missing Slack modal metadata."
      });
    }

    const slackUserId = payload.user?.id?.trim() ?? "";
    if (!slackUserId) {
      return reply.status(400).send({
        response_action: "errors",
        errors: {},
        text: "Missing Slack user id."
      });
    }

    const slackEmail = await fetchSlackUserEmail(runtimeCredentials.slackBotToken, slackUserId);
    if (!slackEmail) {
      return reply.status(400).send({
        response_action: "errors",
        errors: {},
        text: "Could not read the Slack user's email address."
      });
    }

    const matchedUser = await deps.userStore.getUserByEmail(slackEmail);
    if (!matchedUser || !matchedUser.active) {
      return reply.status(400).send({
        response_action: "errors",
        errors: {},
        text: "No matching active AgentSwarm account was found for this Slack user email."
      });
    }

    const settings = await deps.settingsStore.getSettings();
    const stateValues = payload.view.state?.values ?? {};
    const repoId = getSlackInputValue(stateValues[SLACK_MODAL_REPO_BLOCK_ID]?.value);
    const title = normalizeWhitespace(getSlackInputValue(stateValues[SLACK_MODAL_TITLE_BLOCK_ID]?.value) ?? "");
    const prompt = normalizeWhitespace(getSlackInputValue(stateValues[SLACK_MODAL_PROMPT_BLOCK_ID]?.value) ?? "");
    const taskType = getSlackInputValue(stateValues[SLACK_MODAL_TASK_TYPE_BLOCK_ID]?.value) === "ask" ? "ask" : "build";
    const startModeValue = getSlackInputValue(stateValues[SLACK_MODAL_START_MODE_BLOCK_ID]?.value);
    const startMode: TaskStartMode =
      startModeValue === "idle" || startModeValue === "prepare_workspace" ? startModeValue : "run_now";
    const providerValue = getSlackInputValue(stateValues[SLACK_MODAL_PROVIDER_BLOCK_ID]?.value);
    const provider: AgentProvider = providerValue === "claude" ? "claude" : "codex";
    const modelOverride = normalizeWhitespace(getSlackInputValue(stateValues[SLACK_MODAL_MODEL_BLOCK_ID]?.value) ?? "");
    const effortValue = getSlackInputValue(stateValues[SLACK_MODAL_EFFORT_BLOCK_ID]?.value);
    const providerProfile: ProviderProfile =
      effortValue === "low" || effortValue === "medium" || effortValue === "high" || effortValue === "max"
        ? effortValue
        : provider === "claude"
          ? settings.claudeDefaultEffort
          : settings.codexDefaultEffort;
    const credentialValue = getSlackInputValue(stateValues[SLACK_MODAL_CREDENTIALS_BLOCK_ID]?.value);
    const codexCredentialSource: CodexCredentialSource =
      credentialValue === "profile" || credentialValue === "global" || credentialValue === "auto" ? credentialValue : "auto";

    const validationErrors: Record<string, string> = {};
    if (!repoId) {
      validationErrors[SLACK_MODAL_REPO_BLOCK_ID] = "Select a repository.";
    }
    if (startMode === "run_now" && prompt.length === 0) {
      validationErrors[SLACK_MODAL_PROMPT_BLOCK_ID] = "Prompt is required when Start mode is Run now.";
    }
    if (Object.keys(validationErrors).length > 0) {
      return reply.send({
        response_action: "errors",
        errors: validationErrors
      });
    }

    const repository = await deps.repositoryStore.getRepository(repoId);
    if (!repository || !canUserAccessRepository(matchedUser, repository.id)) {
      return reply.send({
        response_action: "errors",
        errors: {
          [SLACK_MODAL_REPO_BLOCK_ID]: "That repository is not available to your AgentSwarm account."
        }
      });
    }

    reply.send({
      response_action: "clear"
    });

    setImmediate(() => {
      void (async (): Promise<void> => {
        try {
          const finalProviderProfile =
            effortValue === "low" || effortValue === "medium" || effortValue === "high" || effortValue === "max"
              ? effortValue
              : provider === "claude"
                ? settings.claudeDefaultEffort
                : settings.codexDefaultEffort;
          const finalModelOverride =
            modelOverride || (provider === "claude" ? settings.claudeDefaultModel : settings.codexDefaultModel);
          const finalTitle = title || summarizePrompt(prompt) || "Slack task";

          const createdTask = await deps.taskStore.createTask(
            {
              title: finalTitle,
              repoId: repository.id,
              prompt,
              taskType,
              provider,
              providerProfile: finalProviderProfile,
              modelOverride: finalModelOverride,
              codexCredentialSource,
              startMode
            },
            repository,
            matchedUser.id
          );

          await deps.workflowService.createTaskThread(createdTask, metadata.channelId ?? "").catch((error) => {
            request.log.warn({ error }, "Failed to create Slack task thread");
          });

          const startedTask = await applyTaskStartMode(
            createdTask,
            startMode,
            {
              taskStore: deps.taskStore,
              scheduler: deps.scheduler,
              spawner: deps.spawner
            },
            prompt.length > 0 ? { content: prompt } : undefined
          ).catch(async (error: unknown) => {
            const message = error instanceof Error ? error.message : "Task follow-up failed";
            await deps.taskStore.appendLog(createdTask.id, `Slack task start failed: ${message}`);
            return (await deps.taskStore.getTask(createdTask.id)) ?? createdTask;
          });

          const link = buildTaskLink(startedTask.id);
          await postSlackResponse(
            metadata.responseUrl,
            [
              `Created task: ${startedTask.title}`,
              `Id: ${startedTask.id}`,
              `Status: ${getTaskStatusLabel(startedTask.status)}`,
              link ? `Open: ${link}` : null
            ]
              .filter((line): line is string => Boolean(line))
              .join("\n")
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Slack task creation failed";
          request.log.error({ error }, "Slack modal submission failed");
          await postSlackResponse(metadata.responseUrl, message).catch((postError) => {
            request.log.error({ error: postError }, "Failed to deliver Slack modal response");
          });
        }
      })();
    });
  });
};
