import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type { CreateTaskDraftInput, TaskDraft, TaskDraftDefinition, UpdateTaskDraftInput } from "@agentswarm/shared-types";

const TASK_DRAFT_KEY_PREFIX = "agentswarm:task_draft:";
const TASK_DRAFT_IDS_KEY_PREFIX = "agentswarm:task_draft_ids:";

const nowIso = (): string => new Date().toISOString();

const normalizeDeadline = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const normalizeString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : undefined;
};

const normalizeStringMap = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    result[key] = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const normalizeAttachments = (value: unknown): TaskDraftDefinition["attachments"] => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const name = normalizeString(record.name, 255);
      const mimeType = normalizeString(record.mimeType, 255);
      const dataBase64 = typeof record.dataBase64 === "string" ? record.dataBase64 : "";
      if (!name || !mimeType || dataBase64.length === 0) {
        return null;
      }
      return { name, mimeType, dataBase64 };
    })
    .filter((entry): entry is NonNullable<TaskDraftDefinition["attachments"]>[number] => entry !== null)
    .slice(0, 6);
};

export const normalizeTaskDraftDefinition = (value: unknown): TaskDraftDefinition => {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const sourceType =
    record.sourceType === "snippet" || record.sourceType === "sequence" || record.sourceType === "issue" || record.sourceType === "pull_request"
      ? record.sourceType
      : "blank";
  const provider = record.provider === "claude" ? "claude" : record.provider === "codex" ? "codex" : undefined;
  const taskType = record.taskType === "ask" ? "ask" : record.taskType === "build" ? "build" : undefined;
  const providerProfile =
    record.providerProfile === "low" || record.providerProfile === "medium" || record.providerProfile === "high" || record.providerProfile === "max"
      ? record.providerProfile
      : undefined;
  const codexCredentialSource =
    record.codexCredentialSource === "profile" || record.codexCredentialSource === "global" || record.codexCredentialSource === "auto"
      ? record.codexCredentialSource
      : undefined;
  const branchStrategy = record.branchStrategy === "work_on_branch" ? "work_on_branch" : record.branchStrategy === "feature_branch" ? "feature_branch" : undefined;
  const numberOrUndefined = (raw: unknown): number | undefined => (Number.isFinite(raw) ? Math.max(0, Math.floor(Number(raw))) : undefined);

  return {
    sourceType,
    title: normalizeString(record.title, 500),
    deadline: normalizeDeadline(record.deadline),
    repoId: normalizeString(record.repoId, 120),
    prompt: typeof record.prompt === "string" ? record.prompt : undefined,
    notes: typeof record.notes === "string" ? record.notes : undefined,
    taskType,
    provider,
    model: normalizeString(record.model, 256),
    providerProfile,
    codexCredentialSource,
    baseBranch: normalizeString(record.baseBranch, 255),
    branchStrategy,
    issueNumber: numberOrUndefined(record.issueNumber),
    includeComments: typeof record.includeComments === "boolean" ? record.includeComments : undefined,
    pullRequestNumber: numberOrUndefined(record.pullRequestNumber),
    snippetId: normalizeString(record.snippetId, 120),
    snippetVariables: normalizeStringMap(record.snippetVariables),
    sequenceId: normalizeString(record.sequenceId, 120),
    sequenceVariables: normalizeStringMap(record.sequenceVariables),
    attachments: normalizeAttachments(record.attachments)
  };
};

const normalizeDraftTitle = (input: Pick<CreateTaskDraftInput | UpdateTaskDraftInput, "title" | "definition">): string => {
  const explicit = normalizeString(input.title, 500);
  if (explicit) {
    return explicit;
  }
  const fromDefinition = normalizeString(input.definition?.title, 500);
  return fromDefinition ?? "Untitled Draft";
};

export interface TaskDraftStore {
  createDraft(ownerUserId: string, input: CreateTaskDraftInput): Promise<TaskDraft>;
  listDrafts(ownerUserId: string): Promise<TaskDraft[]>;
  getDraft(ownerUserId: string, draftId: string): Promise<TaskDraft | null>;
  updateDraft(ownerUserId: string, draftId: string, input: UpdateTaskDraftInput): Promise<TaskDraft | null>;
  deleteDraft(ownerUserId: string, draftId: string): Promise<boolean>;
}

export class RedisTaskDraftStore implements TaskDraftStore {
  constructor(private readonly redis: Redis) {}

  private draftKey(draftId: string): string {
    return `${TASK_DRAFT_KEY_PREFIX}${draftId}`;
  }

  private draftIdsKey(ownerUserId: string): string {
    return `${TASK_DRAFT_IDS_KEY_PREFIX}${ownerUserId}`;
  }

  private normalizeDraft(raw: TaskDraft): TaskDraft {
    return {
      ...raw,
      title: normalizeDraftTitle(raw),
      definition: normalizeTaskDraftDefinition(raw.definition)
    };
  }

  async createDraft(ownerUserId: string, input: CreateTaskDraftInput): Promise<TaskDraft> {
    const timestamp = nowIso();
    const draft: TaskDraft = {
      id: nanoid(),
      ownerUserId,
      title: normalizeDraftTitle(input),
      definition: normalizeTaskDraftDefinition(input.definition),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.redis.multi().set(this.draftKey(draft.id), JSON.stringify(draft)).sadd(this.draftIdsKey(ownerUserId), draft.id).exec();
    return draft;
  }

  async listDrafts(ownerUserId: string): Promise<TaskDraft[]> {
    const ids = await this.redis.smembers(this.draftIdsKey(ownerUserId));
    if (ids.length === 0) {
      return [];
    }
    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.get(this.draftKey(id));
    }
    const rows = await pipeline.exec();
    const drafts: TaskDraft[] = [];
    for (const row of rows ?? []) {
      if (typeof row[1] === "string") {
        drafts.push(this.normalizeDraft(JSON.parse(row[1]) as TaskDraft));
      }
    }
    return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getDraft(ownerUserId: string, draftId: string): Promise<TaskDraft | null> {
    const raw = await this.redis.get(this.draftKey(draftId));
    if (!raw) {
      return null;
    }
    const draft = this.normalizeDraft(JSON.parse(raw) as TaskDraft);
    return draft.ownerUserId === ownerUserId ? draft : null;
  }

  async updateDraft(ownerUserId: string, draftId: string, input: UpdateTaskDraftInput): Promise<TaskDraft | null> {
    const current = await this.getDraft(ownerUserId, draftId);
    if (!current) {
      return null;
    }
    const definition = input.definition === undefined ? current.definition : normalizeTaskDraftDefinition(input.definition);
    const next: TaskDraft = {
      ...current,
      title: normalizeDraftTitle({ title: input.title ?? current.title, definition }),
      definition,
      updatedAt: nowIso()
    };
    await this.redis.set(this.draftKey(draftId), JSON.stringify(next));
    return next;
  }

  async deleteDraft(ownerUserId: string, draftId: string): Promise<boolean> {
    const current = await this.getDraft(ownerUserId, draftId);
    if (!current) {
      return false;
    }
    await this.redis.multi().del(this.draftKey(draftId)).srem(this.draftIdsKey(ownerUserId), draftId).exec();
    return true;
  }
}

export class PostgresTaskDraftStore implements TaskDraftStore {
  constructor(private readonly pool: Pool) {}

  private normalizeDraft(row: Record<string, unknown>): TaskDraft {
    const definition = normalizeTaskDraftDefinition(row.definition);
    return {
      id: String(row.id),
      ownerUserId: String(row.owner_user_id),
      title: normalizeDraftTitle({ title: typeof row.title === "string" ? row.title : undefined, definition }),
      definition,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  async createDraft(ownerUserId: string, input: CreateTaskDraftInput): Promise<TaskDraft> {
    const timestamp = nowIso();
    const definition = normalizeTaskDraftDefinition(input.definition);
    const draft: TaskDraft = {
      id: nanoid(),
      ownerUserId,
      title: normalizeDraftTitle({ title: input.title, definition }),
      definition,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.pool.query(
      "INSERT INTO task_drafts (id, owner_user_id, title, definition, created_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)",
      [draft.id, draft.ownerUserId, draft.title, JSON.stringify(draft.definition), draft.createdAt, draft.updatedAt]
    );
    return draft;
  }

  async listDrafts(ownerUserId: string): Promise<TaskDraft[]> {
    const result = await this.pool.query(
      "SELECT id, owner_user_id, title, definition, created_at, updated_at FROM task_drafts WHERE owner_user_id = $1 ORDER BY updated_at DESC",
      [ownerUserId]
    );
    return result.rows.map((row) => this.normalizeDraft(row));
  }

  async getDraft(ownerUserId: string, draftId: string): Promise<TaskDraft | null> {
    const result = await this.pool.query(
      "SELECT id, owner_user_id, title, definition, created_at, updated_at FROM task_drafts WHERE owner_user_id = $1 AND id = $2",
      [ownerUserId, draftId]
    );
    return result.rows[0] ? this.normalizeDraft(result.rows[0]) : null;
  }

  async updateDraft(ownerUserId: string, draftId: string, input: UpdateTaskDraftInput): Promise<TaskDraft | null> {
    const current = await this.getDraft(ownerUserId, draftId);
    if (!current) {
      return null;
    }
    const definition = input.definition === undefined ? current.definition : normalizeTaskDraftDefinition(input.definition);
    const title = normalizeDraftTitle({ title: input.title ?? current.title, definition });
    const updatedAt = nowIso();
    const result = await this.pool.query(
      `UPDATE task_drafts
       SET title = $3, definition = $4::jsonb, updated_at = $5
       WHERE owner_user_id = $1 AND id = $2
       RETURNING id, owner_user_id, title, definition, created_at, updated_at`,
      [ownerUserId, draftId, title, JSON.stringify(definition), updatedAt]
    );
    return result.rows[0] ? this.normalizeDraft(result.rows[0]) : null;
  }

  async deleteDraft(ownerUserId: string, draftId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM task_drafts WHERE owner_user_id = $1 AND id = $2", [ownerUserId, draftId]);
    return (result.rowCount ?? 0) > 0;
  }
}
