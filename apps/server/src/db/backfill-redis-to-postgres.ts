import type Redis from "ioredis";
import { env } from "../config/env.js";
import { createPostgresPool, runPostgresMigrations, withPostgresTransaction } from "../lib/postgres.js";
import { createRedisClients } from "../lib/redis.js";

const ROLE_KEY_PREFIX = "agentswarm:role:";
const ROLE_IDS_KEY = "agentswarm:role_ids";

const USER_KEY_PREFIX = "agentswarm:user:";
const USER_IDS_KEY = "agentswarm:user_ids";
const BOOTSTRAP_ADMIN_MARKER_KEY = "agentswarm:bootstrap_admin_user_id";

const REPO_KEY_PREFIX = "agentswarm:repo:";
const REPO_IDS_KEY = "agentswarm:repo_ids";

const SNIPPET_KEY_PREFIX = "agentswarm:snippet:";
const SNIPPET_IDS_KEY = "agentswarm:snippet_ids";

const SETTINGS_KEY = "agentswarm:settings";
const CREDENTIALS_KEY = "agentswarm:credential_settings";

const TASK_KEY_PREFIX = "agentswarm:task:";
const TASK_LOG_KEY_PREFIX = "agentswarm:task_logs:";
const TASK_MESSAGE_KEY_PREFIX = "agentswarm:task_messages:";
const TASK_RUN_KEY_PREFIX = "agentswarm:task_run:";
const TASK_RUN_LOG_KEY_PREFIX = "agentswarm:task_run_logs:";
const TASK_RUN_IDS_KEY_PREFIX = "agentswarm:task_run_ids:";
const TASK_CHANGE_PROPOSAL_KEY_PREFIX = "agentswarm:task_change_proposal:";
const TASK_CHANGE_PROPOSAL_IDS_KEY_PREFIX = "agentswarm:task_change_proposal_ids:";
const TASK_ACTIVE_INTERACTIVE_SESSION_KEY_PREFIX = "agentswarm:task_active_interactive_session:";
const TASK_INTERACTIVE_TERMINAL_TRANSCRIPT_KEY_PREFIX = "agentswarm:task_interactive_terminal_transcript:";
const TASK_IDS_KEY = "agentswarm:task_ids";

type JsonRecord = Record<string, unknown>;

interface RoleRecord extends JsonRecord {
  id: string;
  name: string;
  description?: string;
  scopes?: unknown[];
  allowedProviders?: unknown[];
  allowedModels?: unknown[];
  allowedEfforts?: unknown[];
  scopeVersion?: number;
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserRecord extends JsonRecord {
  id: string;
  name: string;
  email: string;
  active?: boolean;
  roleIds?: string[];
  repositoryIds?: string[];
  passwordHash: string;
  passwordSalt: string;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RepositoryRecord extends JsonRecord {
  id: string;
  name: string;
  url: string;
  defaultBranch?: string;
  envVars?: unknown[];
  webhookUrl?: string | null;
  webhookEnabled?: boolean;
  webhookSecret?: string | null;
  webhookLastAttemptAt?: string | null;
  webhookLastStatus?: string | null;
  webhookLastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SnippetRecord extends JsonRecord {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface SettingsRecord extends JsonRecord {
  defaultProvider?: string;
  maxAgents?: number;
  branchPrefix?: string;
  gitUsername?: string;
  mcpServers?: unknown[];
  openaiBaseUrl?: string | null;
  codexDefaultModel?: string;
  codexDefaultEffort?: string;
  claudeDefaultModel?: string;
  claudeDefaultEffort?: string;
}

interface TaskRecord extends JsonRecord {
  id: string;
  ownerUserId?: string | null;
  status?: string;
  pinned?: boolean;
  createdAt: string;
}

const nowIso = (): string => new Date().toISOString();

const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const getJson = async <T>(redis: Redis, key: string): Promise<T | null> => parseJson<T>(await redis.get(key));

const trimString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const repositoryEnvVarArray = (value: unknown): Array<{ key: string; value: string }> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const rawKey = (entry as Record<string, unknown>).key;
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || seen.has(key)) {
      continue;
    }
    const rawValue = (entry as Record<string, unknown>).value;
    const normalizedValue = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
    normalized.push({ key, value: normalizedValue });
    seen.add(key);
  }
  return normalized;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
        )
      )
    : [];

const loadRoles = async (redis: Redis): Promise<RoleRecord[]> => {
  const roleIds = await redis.smembers(ROLE_IDS_KEY);
  const roles: RoleRecord[] = [];
  for (const roleId of roleIds) {
    const role = await getJson<RoleRecord>(redis, `${ROLE_KEY_PREFIX}${roleId}`);
    if (role?.id) {
      roles.push(role);
    }
  }
  return roles;
};

const loadUsers = async (redis: Redis): Promise<UserRecord[]> => {
  const userIds = await redis.smembers(USER_IDS_KEY);
  const users: UserRecord[] = [];
  for (const userId of userIds) {
    const user = await getJson<UserRecord>(redis, `${USER_KEY_PREFIX}${userId}`);
    if (user?.id) {
      users.push(user);
    }
  }
  return users;
};

const loadRepositories = async (redis: Redis): Promise<RepositoryRecord[]> => {
  const repositoryIds = await redis.smembers(REPO_IDS_KEY);
  const repositories: RepositoryRecord[] = [];
  for (const repositoryId of repositoryIds) {
    const repository = await getJson<RepositoryRecord>(redis, `${REPO_KEY_PREFIX}${repositoryId}`);
    if (repository?.id) {
      repositories.push(repository);
    }
  }
  return repositories;
};

const loadSnippets = async (redis: Redis): Promise<SnippetRecord[]> => {
  const snippetIds = await redis.smembers(SNIPPET_IDS_KEY);
  const snippets: SnippetRecord[] = [];
  for (const snippetId of snippetIds) {
    const snippet = await getJson<SnippetRecord>(redis, `${SNIPPET_KEY_PREFIX}${snippetId}`);
    if (snippet?.id) {
      snippets.push(snippet);
    }
  }
  return snippets;
};

interface TaskSnapshot {
  task: TaskRecord;
  logs: string[];
  messages: JsonRecord[];
  runs: Array<{ run: JsonRecord; logs: string[] }>;
  proposals: JsonRecord[];
  activeInteractiveSession: JsonRecord | null;
  transcripts: JsonRecord[];
}

const loadTaskSnapshots = async (redis: Redis): Promise<TaskSnapshot[]> => {
  const taskIds = await redis.smembers(TASK_IDS_KEY);
  const snapshots: TaskSnapshot[] = [];

  for (const taskId of taskIds) {
    const task = await getJson<TaskRecord>(redis, `${TASK_KEY_PREFIX}${taskId}`);
    if (!task?.id) {
      continue;
    }

    const [logs, rawMessages, runIds, proposalIds, activeInteractiveSession] = await Promise.all([
      redis.lrange(`${TASK_LOG_KEY_PREFIX}${taskId}`, 0, -1),
      redis.lrange(`${TASK_MESSAGE_KEY_PREFIX}${taskId}`, 0, -1),
      redis.lrange(`${TASK_RUN_IDS_KEY_PREFIX}${taskId}`, 0, -1),
      redis.lrange(`${TASK_CHANGE_PROPOSAL_IDS_KEY_PREFIX}${taskId}`, 0, -1),
      getJson<JsonRecord>(redis, `${TASK_ACTIVE_INTERACTIVE_SESSION_KEY_PREFIX}${taskId}`)
    ]);

    const messages = rawMessages
      .map((raw) => parseJson<JsonRecord>(raw))
      .filter((message): message is JsonRecord => message !== null);

    const runs: Array<{ run: JsonRecord; logs: string[] }> = [];
    for (const runId of runIds) {
      const run = await getJson<JsonRecord>(redis, `${TASK_RUN_KEY_PREFIX}${runId}`);
      if (!run) {
        continue;
      }

      const runLogs = await redis.lrange(`${TASK_RUN_LOG_KEY_PREFIX}${runId}`, 0, -1);
      runs.push({ run, logs: runLogs });
    }

    const proposals: JsonRecord[] = [];
    for (const proposalId of proposalIds) {
      const proposal = await getJson<JsonRecord>(redis, `${TASK_CHANGE_PROPOSAL_KEY_PREFIX}${proposalId}`);
      if (proposal) {
        proposals.push(proposal);
      }
    }

    const transcriptsBySessionId = new Map<string, JsonRecord>();
    for (const message of messages) {
      const sessionId = trimString(message.sessionId);
      if (!sessionId) {
        continue;
      }

      const transcript = await getJson<JsonRecord>(redis, `${TASK_INTERACTIVE_TERMINAL_TRANSCRIPT_KEY_PREFIX}${sessionId}`);
      if (transcript) {
        transcriptsBySessionId.set(sessionId, transcript);
      }
    }

    snapshots.push({
      task,
      logs,
      messages,
      runs,
      proposals,
      activeInteractiveSession,
      transcripts: Array.from(transcriptsBySessionId.values())
    });
  }

  return snapshots;
};

const main = async (): Promise<void> => {
  const redisClients = createRedisClients(env.REDIS_URL);
  const postgresPool = createPostgresPool(env.DATABASE_URL);

  try {
    await runPostgresMigrations(postgresPool);

    const redis = redisClients.command;
    const [roles, users, repositories, snippets, settings, credentialsRaw, taskSnapshots, bootstrapAdminUserId] = await Promise.all([
      loadRoles(redis),
      loadUsers(redis),
      loadRepositories(redis),
      loadSnippets(redis),
      getJson<SettingsRecord>(redis, SETTINGS_KEY),
      redis.get(CREDENTIALS_KEY),
      loadTaskSnapshots(redis),
      redis.get(BOOTSTRAP_ADMIN_MARKER_KEY)
    ]);
    const repositoryIds = new Set(repositories.map((repository) => repository.id));
    let skippedUserRepositoryAssignments = 0;

    await withPostgresTransaction(postgresPool, async (client) => {
      await client.query(`
        TRUNCATE TABLE
          task_run_logs,
          task_messages,
          task_logs,
          task_change_proposals,
          task_active_interactive_sessions,
          task_interactive_terminal_transcripts,
          task_runs,
          tasks,
          user_repositories,
          user_roles,
          users,
          roles,
          repositories,
          snippets,
          system_settings,
          credentials,
          app_metadata
        RESTART IDENTITY CASCADE
      `);

      if (bootstrapAdminUserId) {
        await client.query(
          "INSERT INTO app_metadata (key, value, updated_at) VALUES ($1, $2, $3)",
          [BOOTSTRAP_ADMIN_MARKER_KEY, bootstrapAdminUserId, nowIso()]
        );
      }

      for (const role of roles) {
        await client.query(
          `
            INSERT INTO roles (
              id,
              name,
              name_key,
              description,
              scopes,
              allowed_providers,
              allowed_models,
              allowed_efforts,
              scope_version,
              is_system,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12)
          `,
          [
            role.id,
            String(role.name ?? "").trim(),
            String(role.name ?? "").trim().toLowerCase(),
            String(role.description ?? "").trim(),
            JSON.stringify(Array.isArray(role.scopes) ? role.scopes : []),
            JSON.stringify(Array.isArray(role.allowedProviders) ? role.allowedProviders : []),
            JSON.stringify(Array.isArray(role.allowedModels) ? role.allowedModels : []),
            JSON.stringify(Array.isArray(role.allowedEfforts) ? role.allowedEfforts : []),
            typeof role.scopeVersion === "number" ? role.scopeVersion : 0,
            role.isSystem === true,
            role.createdAt,
            role.updatedAt
          ]
        );
      }

      for (const user of users) {
        await client.query(
          `
            INSERT INTO users (
              id,
              name,
              email,
              active,
              password_hash,
              password_salt,
              last_login_at,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            user.id,
            String(user.name ?? "").trim(),
            String(user.email ?? "").trim().toLowerCase(),
            user.active !== false,
            user.passwordHash,
            user.passwordSalt,
            user.lastLoginAt ?? null,
            user.createdAt,
            user.updatedAt
          ]
        );

        for (const roleId of stringArray(user.roleIds)) {
          await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [user.id, roleId]);
        }
      }

      for (const repository of repositories) {
        await client.query(
          `
            INSERT INTO repositories (
              id,
              name,
              url,
              default_branch,
              env_vars,
              webhook_url,
              webhook_enabled,
              webhook_secret,
              webhook_last_attempt_at,
              webhook_last_status,
              webhook_last_error,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)
          `,
          [
            repository.id,
            String(repository.name ?? "").trim(),
            String(repository.url ?? "").trim(),
            trimString(repository.defaultBranch) ?? "develop",
            JSON.stringify(repositoryEnvVarArray(repository.envVars)),
            trimString(repository.webhookUrl),
            repository.webhookEnabled === true,
            trimString(repository.webhookSecret),
            repository.webhookLastAttemptAt ?? null,
            trimString(repository.webhookLastStatus),
            trimString(repository.webhookLastError),
            repository.createdAt,
            repository.updatedAt
          ]
        );
      }

      for (const user of users) {
        for (const repositoryId of stringArray(user.repositoryIds)) {
          if (!repositoryIds.has(repositoryId)) {
            skippedUserRepositoryAssignments += 1;
            continue;
          }
          await client.query("INSERT INTO user_repositories (user_id, repository_id) VALUES ($1, $2)", [user.id, repositoryId]);
        }
      }

      for (const snippet of snippets) {
        await client.query(
          "INSERT INTO snippets (id, name, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
          [snippet.id, String(snippet.name ?? "").trim(), String(snippet.content ?? "").trim(), snippet.createdAt, snippet.updatedAt]
        );
      }

      if (settings) {
        await client.query(
          `
            INSERT INTO system_settings (
              singleton_id,
              default_provider,
              max_agents,
              branch_prefix,
              git_username,
              mcp_servers,
              openai_base_url,
              codex_default_model,
              codex_default_effort,
              claude_default_model,
              claude_default_effort
            )
            VALUES (1, $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
          `,
          [
            trimString(settings.defaultProvider) ?? "codex",
            typeof settings.maxAgents === "number" ? settings.maxAgents : 2,
            trimString(settings.branchPrefix) ?? "agentswarm",
            trimString(settings.gitUsername) ?? "x-access-token",
            JSON.stringify(Array.isArray(settings.mcpServers) ? settings.mcpServers : []),
            trimString(settings.openaiBaseUrl),
            trimString(settings.codexDefaultModel) ?? "gpt-5.4",
            trimString(settings.codexDefaultEffort) ?? "high",
            trimString(settings.claudeDefaultModel) ?? "claude-sonnet-4-5",
            trimString(settings.claudeDefaultEffort) ?? "high"
          ]
        );
      }

      if (credentialsRaw) {
        await client.query(
          "INSERT INTO credentials (singleton_id, payload_encrypted, updated_at) VALUES (1, $1, $2)",
          [credentialsRaw, nowIso()]
        );
      }

      for (const snapshot of taskSnapshots) {
        const { task, logs, messages, runs, proposals, activeInteractiveSession, transcripts } = snapshot;

        await client.query(
          `
            INSERT INTO tasks (id, owner_user_id, status, pinned, created_at, task_data)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          `,
          [
            task.id,
            trimString(task.ownerUserId),
            trimString(task.status) ?? "open",
            task.pinned === true,
            task.createdAt,
            JSON.stringify(task)
          ]
        );

        for (const line of logs) {
          await client.query("INSERT INTO task_logs (task_id, line) VALUES ($1, $2)", [task.id, line]);
        }

        for (const message of messages) {
          const messageId = trimString(message.id);
          const createdAt = trimString(message.createdAt);
          if (!messageId || !createdAt) {
            continue;
          }

          await client.query(
            `
              INSERT INTO task_messages (message_id, task_id, created_at, message_data)
              VALUES ($1, $2, $3, $4::jsonb)
            `,
            [messageId, task.id, createdAt, JSON.stringify(message)]
          );
        }

        for (const { run, logs: runLogs } of runs) {
          const runId = trimString(run.id);
          const startedAt = trimString(run.startedAt);
          if (!runId || !startedAt) {
            continue;
          }

          await client.query(
            "INSERT INTO task_runs (id, task_id, started_at, run_data) VALUES ($1, $2, $3, $4::jsonb)",
            [runId, task.id, startedAt, JSON.stringify(run)]
          );

          for (const line of runLogs) {
            await client.query("INSERT INTO task_run_logs (run_id, line) VALUES ($1, $2)", [runId, line]);
          }
        }

        for (const proposal of proposals) {
          const proposalId = trimString(proposal.id);
          const createdAt = trimString(proposal.createdAt);
          if (!proposalId || !createdAt) {
            continue;
          }

          await client.query(
            `
              INSERT INTO task_change_proposals (id, task_id, status, created_at, resolved_at, proposal_data)
              VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            `,
            [
              proposalId,
              task.id,
              trimString(proposal.status) ?? "pending",
              createdAt,
              trimString(proposal.resolvedAt),
              JSON.stringify(proposal)
            ]
          );
        }

        if (activeInteractiveSession) {
          await client.query(
            "INSERT INTO task_active_interactive_sessions (task_id, session_data) VALUES ($1, $2::jsonb)",
            [task.id, JSON.stringify(activeInteractiveSession)]
          );
        }

        for (const transcript of transcripts) {
          const sessionId = trimString(transcript.sessionId);
          if (!sessionId) {
            continue;
          }

          await client.query(
            `
              INSERT INTO task_interactive_terminal_transcripts (session_id, task_id, transcript_data)
              VALUES ($1, $2, $3::jsonb)
              ON CONFLICT (session_id) DO UPDATE
              SET
                task_id = EXCLUDED.task_id,
                transcript_data = EXCLUDED.transcript_data
            `,
            [sessionId, task.id, JSON.stringify(transcript)]
          );
        }
      }
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          roles: roles.length,
          users: users.length,
          repositories: repositories.length,
          skippedUserRepositoryAssignments,
          snippets: snippets.length,
          tasks: taskSnapshots.length
        },
        null,
        2
      )
    );
  } finally {
    await Promise.all([
      postgresPool.end(),
      redisClients.command.quit(),
      redisClients.pub.quit(),
      redisClients.sub.quit()
    ]);
  }
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
