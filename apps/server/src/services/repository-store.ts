import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type {
  CreateRepositoryInput,
  Repository,
  RepositoryEnvVarInput,
  RepositoryEnvSecret,
  RepositoryEnvSecretInput,
  UpdateRepositoryInput
} from "@agentswarm/shared-types";
import { DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS } from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";
import { HttpError } from "../lib/http-error.js";
import { RepositoryEnvFileStore } from "./repository-env-file-store.js";

const REPO_KEY_PREFIX = "agentswarm:repo:";
const REPO_IDS_KEY = "agentswarm:repo_ids";
const USER_KEY_PREFIX = "agentswarm:user:";
const USER_IDS_KEY = "agentswarm:user_ids";
const REPOSITORY_ENV_VAR_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REPOSITORY_ENV_VAR_MAX_COUNT = 250;
const REPOSITORY_ENV_VAR_KEY_MAX_LENGTH = 128;
const REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH = 8192;
const REPOSITORY_ENV_FILE_NAME_MAX_LENGTH = 255;
const REPOSITORY_ENV_FILE_MAX_BYTES = 256 * 1024;
const REPOSITORY_ENV_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const REPOSITORY_ENV_SECRET_KEY_PATTERN = REPOSITORY_ENV_VAR_KEY_PATTERN;
const REPOSITORY_ENV_SECRET_MAX_COUNT = REPOSITORY_ENV_VAR_MAX_COUNT;
const REPOSITORY_ENV_SECRET_KEY_MAX_LENGTH = REPOSITORY_ENV_VAR_KEY_MAX_LENGTH;
const REPOSITORY_ENV_SECRET_VALUE_MAX_LENGTH = REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH;

const nowIso = (): string => new Date().toISOString();

const normalizeGitHubLogin = (login: string | null | undefined): string | null => {
  const normalized = (login ?? "").trim().replace(/^@+/, "");
  return normalized.length > 0 ? normalized : null;
};

const normalizeGitHubAllowedUsers = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const users: string[] = [];
  const seen = new Set<string>();
  for (const rawUser of value) {
    if (typeof rawUser !== "string") {
      continue;
    }
    const normalized = rawUser.trim().replace(/^@+/, "");
    const comparable = normalized.toLowerCase();
    if (!normalized || seen.has(comparable)) {
      continue;
    }
    users.push(normalized);
    seen.add(comparable);
  }
  return users;
};

const normalizeGitHubPrFeedbackInstructions = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 && normalized !== DEFAULT_GITHUB_PR_FEEDBACK_INSTRUCTIONS ? normalized : null;
};

const normalizeUserId = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

export type RepositoryRuntimeEnvEntry =
  | {
      key: string;
      type: "text";
      value: string;
    }
  | {
      key: string;
      type: "file";
      fileId: string;
      fileName: string;
    };

interface StoredRepositoryEnvTextValue {
  key: string;
  type: "text";
  value: string;
}

interface StoredRepositoryEnvFileValue {
  key: string;
  type: "file";
  fileId: string;
  fileName: string;
  sizeBytes: number;
}

type StoredRepositoryEnvValue = StoredRepositoryEnvTextValue | StoredRepositoryEnvFileValue;

type StoredRepository = Omit<Repository, "webhookSecretConfigured" | "githubPrWebhookSecretConfigured" | "envVars" | "envSecrets"> & {
  envVars: StoredRepositoryEnvValue[];
  envSecrets: StoredRepositoryEnvValue[];
  webhookSecret: string | null;
  githubPrWebhookSecret: string | null;
  webhookSecretConfigured?: boolean;
  githubPrWebhookSecretConfigured?: boolean;
} & Record<string, unknown>;

const normalizeRepositoryEnvFileName = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/[\\/\x00]/g, "_");
  if (normalized.length === 0 || normalized.length > REPOSITORY_ENV_FILE_NAME_MAX_LENGTH) {
    return null;
  }
  return normalized;
};

const decodeRepositoryEnvFileContent = (key: string, contentBase64: string): Buffer => {
  const normalized = contentBase64.trim().replace(/\s+/g, "");
  if (!normalized) {
    throw new HttpError(400, `File content is required for ${key}.`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new HttpError(400, `File content for ${key} is not valid Base64.`);
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.byteLength === 0) {
    throw new HttpError(400, `File content is required for ${key}.`);
  }
  if (decoded.byteLength > REPOSITORY_ENV_FILE_MAX_BYTES) {
    throw new HttpError(400, `File content for ${key} exceeds ${REPOSITORY_ENV_FILE_MAX_BYTES} bytes.`);
  }
  return decoded;
};

const normalizeStoredRepositoryEnvValues = (
  value: unknown,
  options: { secret: boolean }
): StoredRepositoryEnvValue[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: StoredRepositoryEnvValue[] = [];
  const seen = new Set<string>();
  for (const rawEntry of value) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const entry = rawEntry as Record<string, unknown>;
    const rawKey = entry.key;
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (
      !key ||
      key.length > REPOSITORY_ENV_VAR_KEY_MAX_LENGTH ||
      !REPOSITORY_ENV_VAR_KEY_PATTERN.test(key) ||
      seen.has(key)
    ) {
      continue;
    }

    const type = entry.type === "file" ? "file" : "text";
    if (type === "file") {
      const fileId = typeof entry.fileId === "string" ? entry.fileId.trim() : "";
      if (!REPOSITORY_ENV_FILE_ID_PATTERN.test(fileId)) {
        continue;
      }
      const fileName = normalizeRepositoryEnvFileName(entry.fileName) ?? `${key}.bin`;
      const sizeBytes =
        typeof entry.sizeBytes === "number" && Number.isFinite(entry.sizeBytes) && entry.sizeBytes > 0
          ? Math.floor(entry.sizeBytes)
          : 0;
      entries.push({
        key,
        type: "file",
        fileId,
        fileName,
        sizeBytes
      });
      seen.add(key);
      if (entries.length >= REPOSITORY_ENV_VAR_MAX_COUNT) {
        break;
      }
      continue;
    }

    const normalizedValue = typeof entry.value === "string" ? entry.value : String(entry.value ?? "");
    if (normalizedValue.length > REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH) {
      continue;
    }
    if (options.secret && normalizedValue.length === 0) {
      continue;
    }

    entries.push({ key, type: "text", value: normalizedValue });
    seen.add(key);
    if (entries.length >= REPOSITORY_ENV_VAR_MAX_COUNT) {
      break;
    }
  }

  return entries;
};

const toRepositoryEnvVars = (value: StoredRepositoryEnvValue[]): Repository["envVars"] =>
  value.map((entry) =>
    entry.type === "file"
      ? {
          key: entry.key,
          type: "file",
          configured: true,
          fileName: entry.fileName
        }
      : {
          key: entry.key,
          type: "text",
          value: entry.value
        }
  );

const toConfiguredRepositoryEnvSecrets = (value: StoredRepositoryEnvValue[]): RepositoryEnvSecret[] =>
  value.map((entry) => ({
    key: entry.key,
    configured: true,
    type: entry.type,
    ...(entry.type === "file" ? { fileName: entry.fileName } : {})
  }));

type NormalizedRepositoryEnvVarInput =
  | {
      key: string;
      type: "text";
      value: string;
    }
  | {
      key: string;
      type: "file";
      fileName?: string;
      fileContentBase64?: string;
    };

type NormalizedRepositoryEnvSecretInput =
  | {
      key: string;
      type: "text";
      value?: string;
    }
  | {
      key: string;
      type: "file";
      fileName?: string;
      fileContentBase64?: string;
    };

const normalizeRepositoryEnvVarInputs = (value: unknown): NormalizedRepositoryEnvVarInput[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const envVars: NormalizedRepositoryEnvVarInput[] = [];
  const seen = new Set<string>();
  for (const rawEntry of value) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const entry = rawEntry as Record<string, unknown>;
    const rawKey = entry.key;
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (
      !key ||
      key.length > REPOSITORY_ENV_VAR_KEY_MAX_LENGTH ||
      !REPOSITORY_ENV_VAR_KEY_PATTERN.test(key) ||
      seen.has(key)
    ) {
      continue;
    }

    const type = entry.type === "file" ? "file" : "text";
    if (type === "file") {
      envVars.push({
        key,
        type: "file",
        ...(normalizeRepositoryEnvFileName(entry.fileName) ? { fileName: normalizeRepositoryEnvFileName(entry.fileName)! } : {}),
        ...(typeof entry.fileContentBase64 === "string" && entry.fileContentBase64.trim().length > 0
          ? { fileContentBase64: entry.fileContentBase64.trim() }
          : {})
      });
    } else {
      const normalizedValue = typeof entry.value === "string" ? entry.value : String(entry.value ?? "");
      if (normalizedValue.length > REPOSITORY_ENV_VAR_VALUE_MAX_LENGTH) {
        continue;
      }
      envVars.push({ key, type: "text", value: normalizedValue });
    }

    seen.add(key);
    if (envVars.length >= REPOSITORY_ENV_VAR_MAX_COUNT) {
      break;
    }
  }
  return envVars;
};

const normalizeRepositoryEnvSecretInputs = (value: unknown): NormalizedRepositoryEnvSecretInput[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const secrets: NormalizedRepositoryEnvSecretInput[] = [];
  const seen = new Set<string>();
  for (const rawEntry of value) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const entry = rawEntry as Record<string, unknown>;
    const rawKey = entry.key;
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (
      !key ||
      key.length > REPOSITORY_ENV_SECRET_KEY_MAX_LENGTH ||
      !REPOSITORY_ENV_SECRET_KEY_PATTERN.test(key) ||
      seen.has(key)
    ) {
      continue;
    }

    const type = entry.type === "file" ? "file" : "text";
    if (type === "file") {
      secrets.push({
        key,
        type: "file",
        ...(normalizeRepositoryEnvFileName(entry.fileName) ? { fileName: normalizeRepositoryEnvFileName(entry.fileName)! } : {}),
        ...(typeof entry.fileContentBase64 === "string" && entry.fileContentBase64.trim().length > 0
          ? { fileContentBase64: entry.fileContentBase64.trim() }
          : {})
      });
    } else {
      const normalizedValue =
        typeof entry.value === "string" && entry.value.length <= REPOSITORY_ENV_SECRET_VALUE_MAX_LENGTH
          ? entry.value
          : undefined;
      secrets.push({
        key,
        type: "text",
        ...(normalizedValue !== undefined ? { value: normalizedValue } : {})
      });
    }

    seen.add(key);
    if (secrets.length >= REPOSITORY_ENV_SECRET_MAX_COUNT) {
      break;
    }
  }

  return secrets;
};

interface RepositoryEnvResolutionResult {
  entries: StoredRepositoryEnvValue[];
  staleFileIds: string[];
  createdFileIds: string[];
}

const resolveNextRepositoryEnvVars = async (
  fileStore: RepositoryEnvFileStore,
  current: StoredRepositoryEnvValue[],
  input: RepositoryEnvVarInput[] | undefined
): Promise<RepositoryEnvResolutionResult> => {
  if (input === undefined) {
    return { entries: current, staleFileIds: [], createdFileIds: [] };
  }

  const normalizedInput = normalizeRepositoryEnvVarInputs(input);
  const currentByKey = new Map(current.map((entry) => [entry.key, entry] as const));
  const next: StoredRepositoryEnvValue[] = [];
  const staleFileIds = new Set<string>();
  const createdFileIds: string[] = [];

  for (const envVar of normalizedInput) {
    const existing = currentByKey.get(envVar.key);
    if (envVar.type === "text") {
      if (existing?.type === "file") {
        staleFileIds.add(existing.fileId);
      }
      next.push({ key: envVar.key, type: "text", value: envVar.value });
      continue;
    }

    if (typeof envVar.fileContentBase64 === "string" && envVar.fileContentBase64.length > 0) {
      const content = decodeRepositoryEnvFileContent(envVar.key, envVar.fileContentBase64);
      const saved = await fileStore.saveFile(content);
      createdFileIds.push(saved.fileId);
      if (existing?.type === "file") {
        staleFileIds.add(existing.fileId);
      }
      next.push({
        key: envVar.key,
        type: "file",
        fileId: saved.fileId,
        fileName: envVar.fileName ?? (existing?.type === "file" ? existing.fileName : `${envVar.key}.bin`),
        sizeBytes: saved.sizeBytes
      });
      continue;
    }

    if (existing?.type === "file") {
      next.push({
        ...existing,
        fileName: envVar.fileName ?? existing.fileName
      });
      continue;
    }

    throw new HttpError(400, `File value is required for ${envVar.key}.`);
  }

  const nextKeys = new Set(next.map((entry) => entry.key));
  for (const existing of current) {
    if (existing.type === "file" && !nextKeys.has(existing.key)) {
      staleFileIds.add(existing.fileId);
    }
  }

  return {
    entries: next,
    staleFileIds: Array.from(staleFileIds),
    createdFileIds
  };
};

const resolveNextRepositoryEnvSecrets = async (
  fileStore: RepositoryEnvFileStore,
  current: StoredRepositoryEnvValue[],
  input: RepositoryEnvSecretInput[] | undefined
): Promise<RepositoryEnvResolutionResult> => {
  if (input === undefined) {
    return { entries: current, staleFileIds: [], createdFileIds: [] };
  }

  const normalizedInput = normalizeRepositoryEnvSecretInputs(input);
  const currentByKey = new Map(current.map((entry) => [entry.key, entry] as const));
  const next: StoredRepositoryEnvValue[] = [];
  const staleFileIds = new Set<string>();
  const createdFileIds: string[] = [];

  for (const secret of normalizedInput) {
    const existing = currentByKey.get(secret.key);

    if (secret.type === "text") {
      if (typeof secret.value === "string" && secret.value.length > 0) {
        if (existing?.type === "file") {
          staleFileIds.add(existing.fileId);
        }
        next.push({ key: secret.key, type: "text", value: secret.value });
        continue;
      }

      if (existing?.type === "text") {
        next.push(existing);
        continue;
      }

      throw new HttpError(400, `Secret value is required for ${secret.key}.`);
    }

    if (typeof secret.fileContentBase64 === "string" && secret.fileContentBase64.length > 0) {
      const content = decodeRepositoryEnvFileContent(secret.key, secret.fileContentBase64);
      const saved = await fileStore.saveFile(content);
      createdFileIds.push(saved.fileId);
      if (existing?.type === "file") {
        staleFileIds.add(existing.fileId);
      }
      next.push({
        key: secret.key,
        type: "file",
        fileId: saved.fileId,
        fileName: secret.fileName ?? (existing?.type === "file" ? existing.fileName : `${secret.key}.bin`),
        sizeBytes: saved.sizeBytes
      });
      continue;
    }

    if (existing?.type === "file") {
      next.push({
        ...existing,
        fileName: secret.fileName ?? existing.fileName
      });
      continue;
    }

    throw new HttpError(400, `Secret value is required for ${secret.key}.`);
  }

  const nextKeys = new Set(next.map((entry) => entry.key));
  for (const existing of current) {
    if (existing.type === "file" && !nextKeys.has(existing.key)) {
      staleFileIds.add(existing.fileId);
    }
  }

  return {
    entries: next,
    staleFileIds: Array.from(staleFileIds),
    createdFileIds
  };
};

const toRuntimeRepositoryEnvEntries = (
  envVars: StoredRepositoryEnvValue[],
  envSecrets: StoredRepositoryEnvValue[]
): RepositoryRuntimeEnvEntry[] =>
  [...envVars, ...envSecrets].map((entry) =>
    entry.type === "file"
      ? {
          key: entry.key,
          type: "file",
          fileId: entry.fileId,
          fileName: entry.fileName
        }
      : {
          key: entry.key,
          type: "text",
          value: entry.value
        }
  );

const deleteRepositoryEnvFiles = async (fileStore: RepositoryEnvFileStore, fileIds: string[]): Promise<void> => {
  const unique = Array.from(new Set(fileIds.filter((entry) => REPOSITORY_ENV_FILE_ID_PATTERN.test(entry))));
  await Promise.all(unique.map((fileId) => fileStore.deleteFile(fileId)));
};

const collectRepositoryEnvFileIds = (entries: StoredRepositoryEnvValue[]): string[] =>
  entries.filter((entry): entry is StoredRepositoryEnvFileValue => entry.type === "file").map((entry) => entry.fileId);

const normalizeRepositoryEnvVars = (value: unknown): StoredRepositoryEnvValue[] =>
  normalizeStoredRepositoryEnvValues(value, { secret: false });

const normalizeRepositoryEnvSecretValues = (value: unknown): StoredRepositoryEnvValue[] =>
  normalizeStoredRepositoryEnvValues(value, { secret: true });

export interface RepositoryWebhookTarget {
  repository: Repository;
  webhookUrl: string;
  webhookSecret: string;
}

export interface RepositoryStore {
  createRepository(input: CreateRepositoryInput): Promise<Repository>;
  listRepositories(): Promise<Repository[]>;
  getRepository(repositoryId: string): Promise<Repository | null>;
  getRepositoryRuntimeEnvEntries(repositoryId: string): Promise<RepositoryRuntimeEnvEntry[]>;
  updateRepository(repositoryId: string, input: UpdateRepositoryInput): Promise<Repository | null>;
  getRepositoryWebhookTarget(repositoryId: string): Promise<RepositoryWebhookTarget | null>;
  getRepositoryGitHubPrWebhookSecret(repositoryId: string): Promise<string | null>;
  recordWebhookDeliveryResult(
    repositoryId: string,
    input: { status: "success" | "failed"; attemptedAt: string; errorMessage?: string | null }
  ): Promise<Repository | null>;
  deleteRepository(repositoryId: string): Promise<boolean>;
}

export class RedisRepositoryStore implements RepositoryStore {
  constructor(
    private readonly redis: Redis,
    private readonly eventBus: EventBus,
    private readonly repositoryEnvFileStore: RepositoryEnvFileStore = new RepositoryEnvFileStore()
  ) {}

  private repoKey(repoId: string): string {
    return `${REPO_KEY_PREFIX}${repoId}`;
  }

  private userKey(userId: string): string {
    return `${USER_KEY_PREFIX}${userId}`;
  }

  private normalizeUserRepositoryIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );
  }

  private async buildRepositoryRemovalUserUpdates(repositoryId: string): Promise<Array<{ userKey: string; userPayload: string }>> {
    const userIds = await this.redis.smembers(USER_IDS_KEY);
    if (userIds.length === 0) {
      return [];
    }

    const lookupPipeline = this.redis.pipeline();
    for (const userId of userIds) {
      lookupPipeline.get(this.userKey(userId));
    }
    const lookupResults = await lookupPipeline.exec();

    const updates: Array<{ userKey: string; userPayload: string }> = [];
    for (let index = 0; index < userIds.length; index += 1) {
      const raw = lookupResults?.[index]?.[1];
      if (typeof raw !== "string") {
        continue;
      }

      let parsedUser: Record<string, unknown>;
      try {
        parsedUser = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      const repositoryIds = this.normalizeUserRepositoryIds(parsedUser.repositoryIds);
      if (!repositoryIds.includes(repositoryId)) {
        continue;
      }

      const nextRepositoryIds = repositoryIds.filter((entry) => entry !== repositoryId);
      updates.push({
        userKey: this.userKey(userIds[index]!),
        userPayload: JSON.stringify({
          ...parsedUser,
          repositoryIds: nextRepositoryIds,
          updatedAt: nowIso()
        })
      });
    }

    return updates;
  }

  private normalizeWebhookUrl(url: string | null | undefined): string | null {
    const normalized = (url ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeWebhookSecret(secret: string | null | undefined): string | null {
    const normalized = (secret ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private assertValidWebhookConfiguration(input: { webhookEnabled: boolean; webhookUrl: string | null; webhookSecret: string | null }): void {
    if (!input.webhookEnabled) {
      return;
    }

    if (!input.webhookUrl) {
      throw new HttpError(400, "Webhook URL is required when webhooks are enabled.");
    }

    if (!input.webhookSecret) {
      throw new HttpError(400, "Webhook secret is required when webhooks are enabled.");
    }
  }

  private normalizeStoredRepository(repository: StoredRepository): StoredRepository {
    const webhookSecret = this.normalizeWebhookSecret(repository.webhookSecret);
    const githubPrWebhookSecret = this.normalizeWebhookSecret(repository.githubPrWebhookSecret);
    const githubIntegrationBotLogin = normalizeGitHubLogin(repository.githubIntegrationBotLogin);
    const githubPrAllowedUsers = normalizeGitHubAllowedUsers(repository.githubPrAllowedUsers);
    const githubPrFeedbackInstructions = normalizeGitHubPrFeedbackInstructions(repository.githubPrFeedbackInstructions);
    const githubPrTaskOwnerUserId = normalizeUserId(repository.githubPrTaskOwnerUserId);
    const webhookUrl = this.normalizeWebhookUrl(repository.webhookUrl as string | null | undefined);
    const webhookEnabled = repository.webhookEnabled === true;
    const envVars = normalizeRepositoryEnvVars(repository.envVars);
    const envSecrets = normalizeRepositoryEnvSecretValues(repository.envSecrets);
    return {
      ...repository,
      name: String(repository.name ?? "").trim(),
      url: String(repository.url ?? "").trim(),
      defaultBranch: String(repository.defaultBranch ?? "").trim() || "develop",
      envVars,
      envSecrets,
      webhookUrl,
      webhookEnabled,
      webhookSecret,
      githubPrWebhookSecret,
      githubIntegrationBotLogin,
      githubPrAllowedUsers,
      githubPrFeedbackInstructions,
      githubPrTaskOwnerUserId,
      webhookLastAttemptAt: typeof repository.webhookLastAttemptAt === "string" ? repository.webhookLastAttemptAt : null,
      webhookLastStatus: repository.webhookLastStatus === "success" || repository.webhookLastStatus === "failed" ? repository.webhookLastStatus : null,
      webhookLastError: typeof repository.webhookLastError === "string" && repository.webhookLastError.trim().length > 0
        ? repository.webhookLastError.trim()
        : null
    };
  }

  private normalizeRepository(repository: StoredRepository): Repository {
    const normalized = this.normalizeStoredRepository(repository);
    return {
      id: normalized.id,
      name: normalized.name,
      url: normalized.url,
      defaultBranch: normalized.defaultBranch,
      envVars: toRepositoryEnvVars(normalized.envVars),
      envSecrets: toConfiguredRepositoryEnvSecrets(normalized.envSecrets),
      webhookUrl: normalized.webhookUrl,
      webhookEnabled: normalized.webhookEnabled,
      webhookSecretConfigured: Boolean(normalized.webhookSecret),
      githubPrWebhookSecretConfigured: Boolean(normalized.githubPrWebhookSecret),
      githubIntegrationBotLogin: normalized.githubIntegrationBotLogin ?? null,
      githubPrAllowedUsers: normalized.githubPrAllowedUsers,
      githubPrRequireBotMention: normalized.githubPrRequireBotMention === true,
      githubPrFeedbackInstructions: normalized.githubPrFeedbackInstructions ?? null,
      githubPrTaskOwnerUserId: normalized.githubPrTaskOwnerUserId ?? null,
      webhookLastAttemptAt: normalized.webhookLastAttemptAt ?? null,
      webhookLastStatus: normalized.webhookLastStatus ?? null,
      webhookLastError: normalized.webhookLastError ?? null,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt
    };
  }

  private async getStoredRepository(repositoryId: string): Promise<StoredRepository | null> {
    const raw = await this.redis.get(this.repoKey(repositoryId));
    if (!raw) {
      return null;
    }

    return this.normalizeStoredRepository(JSON.parse(raw) as StoredRepository);
  }

  async createRepository(input: CreateRepositoryInput): Promise<Repository> {
    const timestamp = nowIso();
    const webhookUrl = this.normalizeWebhookUrl(input.webhookUrl);
    const webhookSecret = this.normalizeWebhookSecret(input.webhookSecret);
    const githubPrWebhookSecret = this.normalizeWebhookSecret(input.githubPrWebhookSecret);
    const githubIntegrationBotLogin = normalizeGitHubLogin(input.githubIntegrationBotLogin);
    const githubPrAllowedUsers = normalizeGitHubAllowedUsers(input.githubPrAllowedUsers);
    const githubPrFeedbackInstructions = normalizeGitHubPrFeedbackInstructions(input.githubPrFeedbackInstructions);
    const githubPrTaskOwnerUserId = normalizeUserId(input.githubPrTaskOwnerUserId);
    const webhookEnabled = input.webhookEnabled === true;
    const resolvedEnvVars = await resolveNextRepositoryEnvVars(this.repositoryEnvFileStore, [], input.envVars);
    const resolvedEnvSecrets = await resolveNextRepositoryEnvSecrets(this.repositoryEnvFileStore, [], input.envSecrets);
    this.assertValidWebhookConfiguration({
      webhookEnabled,
      webhookUrl,
      webhookSecret
    });

    const stored: StoredRepository = {
      id: nanoid(),
      name: input.name.trim(),
      url: input.url.trim(),
      defaultBranch: input.defaultBranch?.trim() || "develop",
      envVars: resolvedEnvVars.entries,
      envSecrets: resolvedEnvSecrets.entries,
      webhookUrl,
      webhookEnabled,
      webhookSecret,
      githubPrWebhookSecret,
      githubIntegrationBotLogin,
      githubPrAllowedUsers,
      githubPrRequireBotMention: input.githubPrRequireBotMention === true,
      githubPrFeedbackInstructions,
      githubPrTaskOwnerUserId,
      webhookLastAttemptAt: null,
      webhookLastStatus: null,
      webhookLastError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const repository = this.normalizeRepository(stored);
    const createdFileIds = [...resolvedEnvVars.createdFileIds, ...resolvedEnvSecrets.createdFileIds];
    const staleFileIds = [...resolvedEnvVars.staleFileIds, ...resolvedEnvSecrets.staleFileIds];

    try {
      await this.redis
        .multi()
        .set(this.repoKey(repository.id), JSON.stringify(stored))
        .sadd(REPO_IDS_KEY, repository.id)
        .exec();
      await this.eventBus.publish({ type: "repository:created", payload: repository });
    } catch (error) {
      await deleteRepositoryEnvFiles(this.repositoryEnvFileStore, createdFileIds);
      throw error;
    }

    await deleteRepositoryEnvFiles(this.repositoryEnvFileStore, staleFileIds);
    return repository;
  }

  async listRepositories(): Promise<Repository[]> {
    const ids = await this.redis.smembers(REPO_IDS_KEY);
    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.get(this.repoKey(id));
    }

    const result = await pipeline.exec();
    const repositories: Repository[] = [];
    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        repositories.push(this.normalizeRepository(JSON.parse(raw) as StoredRepository));
      }
    }

    return repositories.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getRepository(repositoryId: string): Promise<Repository | null> {
    const stored = await this.getStoredRepository(repositoryId);
    if (!stored) {
      return null;
    }

    return this.normalizeRepository(stored);
  }

  async getRepositoryRuntimeEnvEntries(repositoryId: string): Promise<RepositoryRuntimeEnvEntry[]> {
    const stored = await this.getStoredRepository(repositoryId);
    if (!stored) {
      return [];
    }

    return toRuntimeRepositoryEnvEntries(stored.envVars, stored.envSecrets);
  }

  async updateRepository(repositoryId: string, input: UpdateRepositoryInput): Promise<Repository | null> {
    const current = await this.getStoredRepository(repositoryId);
    if (!current) {
      return null;
    }

    const nextWebhookSecret =
      input.clearWebhookSecret === true
        ? null
        : input.webhookSecret !== undefined
          ? this.normalizeWebhookSecret(input.webhookSecret)
          : current.webhookSecret;
    const nextGithubPrWebhookSecret =
      input.clearGithubPrWebhookSecret === true
        ? null
        : input.githubPrWebhookSecret !== undefined
          ? this.normalizeWebhookSecret(input.githubPrWebhookSecret)
          : current.githubPrWebhookSecret;
    const nextGithubIntegrationBotLogin =
      input.githubIntegrationBotLogin !== undefined
        ? normalizeGitHubLogin(input.githubIntegrationBotLogin)
        : current.githubIntegrationBotLogin ?? null;
    const nextGithubPrAllowedUsers =
      input.githubPrAllowedUsers !== undefined
        ? normalizeGitHubAllowedUsers(input.githubPrAllowedUsers)
        : normalizeGitHubAllowedUsers(current.githubPrAllowedUsers);
    const nextGithubPrFeedbackInstructions =
      input.githubPrFeedbackInstructions !== undefined
        ? normalizeGitHubPrFeedbackInstructions(input.githubPrFeedbackInstructions)
        : current.githubPrFeedbackInstructions ?? null;
    const nextGithubPrTaskOwnerUserId =
      input.githubPrTaskOwnerUserId !== undefined
        ? normalizeUserId(input.githubPrTaskOwnerUserId)
        : current.githubPrTaskOwnerUserId ?? null;
    const nextGithubPrRequireBotMention =
      input.githubPrRequireBotMention !== undefined ? input.githubPrRequireBotMention === true : current.githubPrRequireBotMention === true;
    const nextWebhookUrl =
      input.webhookUrl !== undefined ? this.normalizeWebhookUrl(input.webhookUrl) : current.webhookUrl;
    const nextWebhookEnabled =
      input.webhookEnabled !== undefined ? input.webhookEnabled === true : current.webhookEnabled;
    const resolvedEnvVars = await resolveNextRepositoryEnvVars(this.repositoryEnvFileStore, current.envVars, input.envVars);
    const resolvedEnvSecrets = await resolveNextRepositoryEnvSecrets(
      this.repositoryEnvFileStore,
      current.envSecrets,
      input.envSecrets
    );

    this.assertValidWebhookConfiguration({
      webhookEnabled: nextWebhookEnabled,
      webhookUrl: nextWebhookUrl,
      webhookSecret: nextWebhookSecret
    });

    const nextStored: StoredRepository = {
      ...current,
      name: input.name?.trim() || current.name,
      url: input.url?.trim() || current.url,
      defaultBranch: input.defaultBranch?.trim() || current.defaultBranch,
      envVars: resolvedEnvVars.entries,
      envSecrets: resolvedEnvSecrets.entries,
      webhookUrl: nextWebhookUrl,
      webhookEnabled: nextWebhookEnabled,
      webhookSecret: nextWebhookSecret,
      githubPrWebhookSecret: nextGithubPrWebhookSecret,
      githubIntegrationBotLogin: nextGithubIntegrationBotLogin,
      githubPrAllowedUsers: nextGithubPrAllowedUsers,
      githubPrRequireBotMention: nextGithubPrRequireBotMention,
      githubPrFeedbackInstructions: nextGithubPrFeedbackInstructions,
      githubPrTaskOwnerUserId: nextGithubPrTaskOwnerUserId,
      updatedAt: nowIso()
    };
    const next = this.normalizeRepository(nextStored);
    const createdFileIds = [...resolvedEnvVars.createdFileIds, ...resolvedEnvSecrets.createdFileIds];
    const staleFileIds = [...resolvedEnvVars.staleFileIds, ...resolvedEnvSecrets.staleFileIds];

    try {
      await this.redis.set(this.repoKey(repositoryId), JSON.stringify(nextStored));
      await this.eventBus.publish({ type: "repository:updated", payload: next });
    } catch (error) {
      await deleteRepositoryEnvFiles(this.repositoryEnvFileStore, createdFileIds);
      throw error;
    }

    await deleteRepositoryEnvFiles(this.repositoryEnvFileStore, staleFileIds);
    return next;
  }

  async getRepositoryWebhookTarget(repositoryId: string): Promise<RepositoryWebhookTarget | null> {
    const stored = await this.getStoredRepository(repositoryId);
    if (!stored) {
      return null;
    }

    if (!stored.webhookEnabled || !stored.webhookUrl || !stored.webhookSecret) {
      return null;
    }

    return {
      repository: this.normalizeRepository(stored),
      webhookUrl: stored.webhookUrl,
      webhookSecret: stored.webhookSecret
    };
  }

  async getRepositoryGitHubPrWebhookSecret(repositoryId: string): Promise<string | null> {
    const stored = await this.getStoredRepository(repositoryId);
    return stored?.githubPrWebhookSecret ?? null;
  }

  async recordWebhookDeliveryResult(
    repositoryId: string,
    input: { status: "success" | "failed"; attemptedAt: string; errorMessage?: string | null }
  ): Promise<Repository | null> {
    const stored = await this.getStoredRepository(repositoryId);
    if (!stored) {
      return null;
    }

    const nextStored: StoredRepository = {
      ...stored,
      webhookLastAttemptAt: input.attemptedAt,
      webhookLastStatus: input.status,
      webhookLastError: input.status === "failed" ? input.errorMessage?.trim() || "Webhook delivery failed." : null,
      updatedAt: nowIso()
    };
    const next = this.normalizeRepository(nextStored);

    await this.redis.set(this.repoKey(repositoryId), JSON.stringify(nextStored));
    await this.eventBus.publish({ type: "repository:updated", payload: next });
    return next;
  }

  async deleteRepository(repositoryId: string): Promise<boolean> {
    const stored = await this.getStoredRepository(repositoryId);
    if (!stored) {
      return false;
    }

    const userUpdates = await this.buildRepositoryRemovalUserUpdates(repositoryId);
    const transaction = this.redis.multi();
    for (const userUpdate of userUpdates) {
      transaction.set(userUpdate.userKey, userUpdate.userPayload);
    }
    await transaction.del(this.repoKey(repositoryId)).srem(REPO_IDS_KEY, repositoryId).exec();
    await deleteRepositoryEnvFiles(
      this.repositoryEnvFileStore,
      [...collectRepositoryEnvFileIds(stored.envVars), ...collectRepositoryEnvFileIds(stored.envSecrets)]
    );
    await this.eventBus.publish({ type: "repository:deleted", payload: { id: repositoryId } });
    return true;
  }
}

export class PostgresRepositoryStore implements RepositoryStore {
  constructor(
    private readonly pool: Pool,
    private readonly eventBus: EventBus,
    private readonly repositoryEnvFileStore: RepositoryEnvFileStore = new RepositoryEnvFileStore()
  ) {}

  private normalizeWebhookUrl(url: string | null | undefined): string | null {
    const normalized = (url ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeWebhookSecret(secret: string | null | undefined): string | null {
    const normalized = (secret ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private assertValidWebhookConfiguration(input: { webhookEnabled: boolean; webhookUrl: string | null; webhookSecret: string | null }): void {
    if (!input.webhookEnabled) {
      return;
    }

    if (!input.webhookUrl) {
      throw new HttpError(400, "Webhook URL is required when webhooks are enabled.");
    }

    if (!input.webhookSecret) {
      throw new HttpError(400, "Webhook secret is required when webhooks are enabled.");
    }
  }

  private mapRepositoryRow(row: Record<string, unknown>): Repository {
    const envSecrets = normalizeRepositoryEnvSecretValues(row.env_secrets);
    const envVars = normalizeRepositoryEnvVars(row.env_vars);
    return {
      id: String(row.id),
      name: String(row.name ?? "").trim(),
      url: String(row.url ?? "").trim(),
      defaultBranch: String(row.default_branch ?? "").trim() || "develop",
      envVars: toRepositoryEnvVars(envVars),
      envSecrets: toConfiguredRepositoryEnvSecrets(envSecrets),
      webhookUrl: typeof row.webhook_url === "string" && row.webhook_url.trim().length > 0 ? row.webhook_url.trim() : null,
      webhookEnabled: row.webhook_enabled === true,
      webhookSecretConfigured: typeof row.webhook_secret === "string" && row.webhook_secret.trim().length > 0,
      githubPrWebhookSecretConfigured:
        typeof row.github_pr_webhook_secret === "string" && row.github_pr_webhook_secret.trim().length > 0,
      githubIntegrationBotLogin:
        typeof row.github_integration_bot_login === "string" && row.github_integration_bot_login.trim().length > 0
          ? row.github_integration_bot_login.trim()
          : null,
      githubPrAllowedUsers: normalizeGitHubAllowedUsers(row.github_pr_allowed_users),
      githubPrRequireBotMention: row.github_pr_require_bot_mention === true,
      githubPrFeedbackInstructions:
        typeof row.github_pr_feedback_instructions === "string" && row.github_pr_feedback_instructions.trim().length > 0
          ? row.github_pr_feedback_instructions.trim()
          : null,
      githubPrTaskOwnerUserId:
        typeof row.github_pr_task_owner_user_id === "string" && row.github_pr_task_owner_user_id.trim().length > 0
          ? row.github_pr_task_owner_user_id.trim()
          : null,
      webhookLastAttemptAt: typeof row.webhook_last_attempt_at === "string" ? row.webhook_last_attempt_at : null,
      webhookLastStatus:
        row.webhook_last_status === "success" || row.webhook_last_status === "failed" ? row.webhook_last_status : null,
      webhookLastError:
        typeof row.webhook_last_error === "string" && row.webhook_last_error.trim().length > 0 ? row.webhook_last_error.trim() : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private async getStoredRepositoryRow(repositoryId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query("SELECT * FROM repositories WHERE id = $1", [repositoryId]);
    return result.rows[0] ?? null;
  }

  async createRepository(input: CreateRepositoryInput): Promise<Repository> {
    const timestamp = nowIso();
    const webhookUrl = this.normalizeWebhookUrl(input.webhookUrl);
    const webhookSecret = this.normalizeWebhookSecret(input.webhookSecret);
    const githubPrWebhookSecret = this.normalizeWebhookSecret(input.githubPrWebhookSecret);
    const githubIntegrationBotLogin = normalizeGitHubLogin(input.githubIntegrationBotLogin);
    const githubPrAllowedUsers = normalizeGitHubAllowedUsers(input.githubPrAllowedUsers);
    const githubPrFeedbackInstructions = normalizeGitHubPrFeedbackInstructions(input.githubPrFeedbackInstructions);
    const githubPrTaskOwnerUserId = normalizeUserId(input.githubPrTaskOwnerUserId);
    const webhookEnabled = input.webhookEnabled === true;
    const resolvedEnvVars = await resolveNextRepositoryEnvVars(this.repositoryEnvFileStore, [], input.envVars);
    const resolvedEnvSecrets = await resolveNextRepositoryEnvSecrets(this.repositoryEnvFileStore, [], input.envSecrets);
    this.assertValidWebhookConfiguration({
      webhookEnabled,
      webhookUrl,
      webhookSecret
    });

    const repository = {
      id: nanoid(),
      name: input.name.trim(),
      url: input.url.trim(),
      defaultBranch: input.defaultBranch?.trim() || "develop",
      envVars: toRepositoryEnvVars(resolvedEnvVars.entries),
      envSecrets: toConfiguredRepositoryEnvSecrets(resolvedEnvSecrets.entries),
      webhookUrl,
      webhookEnabled,
      webhookSecretConfigured: Boolean(webhookSecret),
      githubPrWebhookSecretConfigured: Boolean(githubPrWebhookSecret),
      githubIntegrationBotLogin,
      githubPrAllowedUsers,
      githubPrRequireBotMention: input.githubPrRequireBotMention === true,
      githubPrFeedbackInstructions,
      githubPrTaskOwnerUserId,
      webhookLastAttemptAt: null,
      webhookLastStatus: null,
      webhookLastError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    } satisfies Repository;

    const createdFileIds = [...resolvedEnvVars.createdFileIds, ...resolvedEnvSecrets.createdFileIds];
    const staleFileIds = [...resolvedEnvVars.staleFileIds, ...resolvedEnvSecrets.staleFileIds];

    try {
      await this.pool.query(
        `
          INSERT INTO repositories (
            id,
            name,
            url,
            default_branch,
            env_vars,
            env_secrets,
            webhook_url,
            webhook_enabled,
            webhook_secret,
            github_pr_webhook_secret,
            github_integration_bot_login,
            github_pr_allowed_users,
            github_pr_require_bot_mention,
            github_pr_feedback_instructions,
            github_pr_task_owner_user_id,
            webhook_last_attempt_at,
            webhook_last_status,
            webhook_last_error,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20)
        `,
        [
          repository.id,
          repository.name,
          repository.url,
          repository.defaultBranch,
          JSON.stringify(resolvedEnvVars.entries),
          JSON.stringify(resolvedEnvSecrets.entries),
          repository.webhookUrl,
          repository.webhookEnabled,
          webhookSecret,
          githubPrWebhookSecret,
          repository.githubIntegrationBotLogin,
          JSON.stringify(repository.githubPrAllowedUsers),
          repository.githubPrRequireBotMention,
          repository.githubPrFeedbackInstructions,
          repository.githubPrTaskOwnerUserId,
          repository.webhookLastAttemptAt,
          repository.webhookLastStatus,
          repository.webhookLastError,
          repository.createdAt,
          repository.updatedAt
        ]
      );
      await this.eventBus.publish({ type: "repository:created", payload: repository });
    } catch (error) {
      await deleteRepositoryEnvFiles(this.repositoryEnvFileStore, createdFileIds);
      throw error;
    }

    await deleteRepositoryEnvFiles(this.repositoryEnvFileStore, staleFileIds);
    return repository;
  }

  async listRepositories(): Promise<Repository[]> {
    const result = await this.pool.query("SELECT * FROM repositories ORDER BY name ASC");
    return result.rows.map((row) => this.mapRepositoryRow(row));
  }

  async getRepository(repositoryId: string): Promise<Repository | null> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    return row ? this.mapRepositoryRow(row) : null;
  }

  async getRepositoryRuntimeEnvEntries(repositoryId: string): Promise<RepositoryRuntimeEnvEntry[]> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    if (!row) {
      return [];
    }
    return toRuntimeRepositoryEnvEntries(
      normalizeRepositoryEnvVars(row.env_vars),
      normalizeRepositoryEnvSecretValues(row.env_secrets)
    );
  }

  async updateRepository(repositoryId: string, input: UpdateRepositoryInput): Promise<Repository | null> {
    const currentRow = await this.getStoredRepositoryRow(repositoryId);
    if (!currentRow) {
      return null;
    }

    const current = this.mapRepositoryRow(currentRow);
    const currentWebhookSecret =
      typeof currentRow.webhook_secret === "string" && currentRow.webhook_secret.trim().length > 0 ? currentRow.webhook_secret.trim() : null;
    const currentGithubPrWebhookSecret =
      typeof currentRow.github_pr_webhook_secret === "string" && currentRow.github_pr_webhook_secret.trim().length > 0
        ? currentRow.github_pr_webhook_secret.trim()
        : null;
    const currentEnvVars = normalizeRepositoryEnvVars(currentRow.env_vars);
    const currentEnvSecrets = normalizeRepositoryEnvSecretValues(currentRow.env_secrets);
    const nextWebhookSecret =
      input.clearWebhookSecret === true
        ? null
        : input.webhookSecret !== undefined
          ? this.normalizeWebhookSecret(input.webhookSecret)
          : currentWebhookSecret;
    const nextGithubPrWebhookSecret =
      input.clearGithubPrWebhookSecret === true
        ? null
        : input.githubPrWebhookSecret !== undefined
          ? this.normalizeWebhookSecret(input.githubPrWebhookSecret)
          : currentGithubPrWebhookSecret;
    const nextGithubIntegrationBotLogin =
      input.githubIntegrationBotLogin !== undefined
        ? normalizeGitHubLogin(input.githubIntegrationBotLogin)
        : current.githubIntegrationBotLogin ?? null;
    const nextGithubPrAllowedUsers =
      input.githubPrAllowedUsers !== undefined
        ? normalizeGitHubAllowedUsers(input.githubPrAllowedUsers)
        : normalizeGitHubAllowedUsers(current.githubPrAllowedUsers);
    const nextGithubPrFeedbackInstructions =
      input.githubPrFeedbackInstructions !== undefined
        ? normalizeGitHubPrFeedbackInstructions(input.githubPrFeedbackInstructions)
        : current.githubPrFeedbackInstructions ?? null;
    const nextGithubPrTaskOwnerUserId =
      input.githubPrTaskOwnerUserId !== undefined
        ? normalizeUserId(input.githubPrTaskOwnerUserId)
        : current.githubPrTaskOwnerUserId ?? null;
    const nextGithubPrRequireBotMention =
      input.githubPrRequireBotMention !== undefined ? input.githubPrRequireBotMention === true : current.githubPrRequireBotMention === true;
    const nextWebhookUrl =
      input.webhookUrl !== undefined ? this.normalizeWebhookUrl(input.webhookUrl) : current.webhookUrl;
    const nextWebhookEnabled =
      input.webhookEnabled !== undefined ? input.webhookEnabled === true : current.webhookEnabled;
    const resolvedEnvVars = await resolveNextRepositoryEnvVars(this.repositoryEnvFileStore, currentEnvVars, input.envVars);
    const resolvedEnvSecrets = await resolveNextRepositoryEnvSecrets(
      this.repositoryEnvFileStore,
      currentEnvSecrets,
      input.envSecrets
    );

    this.assertValidWebhookConfiguration({
      webhookEnabled: nextWebhookEnabled,
      webhookUrl: nextWebhookUrl,
      webhookSecret: nextWebhookSecret
    });

    const next: Repository = {
      ...current,
      name: input.name?.trim() || current.name,
      url: input.url?.trim() || current.url,
      defaultBranch: input.defaultBranch?.trim() || current.defaultBranch,
      envVars: toRepositoryEnvVars(resolvedEnvVars.entries),
      envSecrets: toConfiguredRepositoryEnvSecrets(resolvedEnvSecrets.entries),
      webhookUrl: nextWebhookUrl,
      webhookEnabled: nextWebhookEnabled,
      webhookSecretConfigured: Boolean(nextWebhookSecret),
      githubPrWebhookSecretConfigured: Boolean(nextGithubPrWebhookSecret),
      githubIntegrationBotLogin: nextGithubIntegrationBotLogin,
      githubPrAllowedUsers: nextGithubPrAllowedUsers,
      githubPrRequireBotMention: nextGithubPrRequireBotMention,
      githubPrFeedbackInstructions: nextGithubPrFeedbackInstructions,
      githubPrTaskOwnerUserId: nextGithubPrTaskOwnerUserId,
      updatedAt: nowIso()
    };

    const createdFileIds = [...resolvedEnvVars.createdFileIds, ...resolvedEnvSecrets.createdFileIds];
    const staleFileIds = [...resolvedEnvVars.staleFileIds, ...resolvedEnvSecrets.staleFileIds];

    try {
      await this.pool.query(
        `
          UPDATE repositories
          SET
            name = $2,
            url = $3,
            default_branch = $4,
            env_vars = $5::jsonb,
            env_secrets = $6::jsonb,
            webhook_url = $7,
            webhook_enabled = $8,
            webhook_secret = $9,
            github_pr_webhook_secret = $10,
            github_integration_bot_login = $11,
            github_pr_allowed_users = $12::jsonb,
            github_pr_require_bot_mention = $13,
            github_pr_feedback_instructions = $14,
            github_pr_task_owner_user_id = $15,
            webhook_last_attempt_at = $16,
            webhook_last_status = $17,
            webhook_last_error = $18,
            created_at = $19,
            updated_at = $20
          WHERE id = $1
        `,
        [
          repositoryId,
          next.name,
          next.url,
          next.defaultBranch,
          JSON.stringify(resolvedEnvVars.entries),
          JSON.stringify(resolvedEnvSecrets.entries),
          next.webhookUrl,
          next.webhookEnabled,
          nextWebhookSecret,
          nextGithubPrWebhookSecret,
          next.githubIntegrationBotLogin,
          JSON.stringify(next.githubPrAllowedUsers),
          next.githubPrRequireBotMention,
          next.githubPrFeedbackInstructions,
          next.githubPrTaskOwnerUserId,
          next.webhookLastAttemptAt,
          next.webhookLastStatus,
          next.webhookLastError,
          next.createdAt,
          next.updatedAt
        ]
      );
      await this.eventBus.publish({ type: "repository:updated", payload: next });
    } catch (error) {
      await deleteRepositoryEnvFiles(this.repositoryEnvFileStore, createdFileIds);
      throw error;
    }

    await deleteRepositoryEnvFiles(this.repositoryEnvFileStore, staleFileIds);
    return next;
  }

  async getRepositoryWebhookTarget(repositoryId: string): Promise<RepositoryWebhookTarget | null> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    if (!row) {
      return null;
    }

    const repository = this.mapRepositoryRow(row);
    const webhookSecret =
      typeof row.webhook_secret === "string" && row.webhook_secret.trim().length > 0 ? row.webhook_secret.trim() : null;

    if (!repository.webhookEnabled || !repository.webhookUrl || !webhookSecret) {
      return null;
    }

    return {
      repository,
      webhookUrl: repository.webhookUrl,
      webhookSecret
    };
  }

  async getRepositoryGitHubPrWebhookSecret(repositoryId: string): Promise<string | null> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    if (!row) {
      return null;
    }
    return typeof row.github_pr_webhook_secret === "string" && row.github_pr_webhook_secret.trim().length > 0
      ? row.github_pr_webhook_secret.trim()
      : null;
  }

  async recordWebhookDeliveryResult(
    repositoryId: string,
    input: { status: "success" | "failed"; attemptedAt: string; errorMessage?: string | null }
  ): Promise<Repository | null> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    if (!row) {
      return null;
    }

    const current = this.mapRepositoryRow(row);
    const webhookSecret =
      typeof row.webhook_secret === "string" && row.webhook_secret.trim().length > 0 ? row.webhook_secret.trim() : null;
    const envVars = normalizeRepositoryEnvVars(row.env_vars);
    const envSecrets = normalizeRepositoryEnvSecretValues(row.env_secrets);
    const next: Repository = {
      ...current,
      webhookLastAttemptAt: input.attemptedAt,
      webhookLastStatus: input.status,
      webhookLastError: input.status === "failed" ? input.errorMessage?.trim() || "Webhook delivery failed." : null,
      updatedAt: nowIso()
    };

    await this.pool.query(
      `
        UPDATE repositories
        SET
          name = $2,
          url = $3,
          default_branch = $4,
          env_vars = $5::jsonb,
          env_secrets = $6::jsonb,
          webhook_url = $7,
          webhook_enabled = $8,
          webhook_secret = $9,
          webhook_last_attempt_at = $10,
          webhook_last_status = $11,
          webhook_last_error = $12,
          created_at = $13,
          updated_at = $14
        WHERE id = $1
      `,
      [
        repositoryId,
        next.name,
        next.url,
        next.defaultBranch,
        JSON.stringify(envVars),
        JSON.stringify(envSecrets),
        next.webhookUrl,
        next.webhookEnabled,
        webhookSecret,
        next.webhookLastAttemptAt,
        next.webhookLastStatus,
        next.webhookLastError,
        next.createdAt,
        next.updatedAt
      ]
    );
    await this.eventBus.publish({ type: "repository:updated", payload: next });
    return next;
  }

  async deleteRepository(repositoryId: string): Promise<boolean> {
    const row = await this.getStoredRepositoryRow(repositoryId);
    if (!row) {
      return false;
    }

    const result = await this.pool.query("DELETE FROM repositories WHERE id = $1", [repositoryId]);
    if (result.rowCount === 0) {
      return false;
    }
    await deleteRepositoryEnvFiles(
      this.repositoryEnvFileStore,
      [
        ...collectRepositoryEnvFileIds(normalizeRepositoryEnvVars(row.env_vars)),
        ...collectRepositoryEnvFileIds(normalizeRepositoryEnvSecretValues(row.env_secrets))
      ]
    );
    await this.eventBus.publish({ type: "repository:deleted", payload: { id: repositoryId } });
    return true;
  }
}
