import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type { CreateSnippetInput, Snippet, SnippetVariable, UpdateSnippetInput } from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";

const SNIPPET_KEY_PREFIX = "agentswarm:snippet:";
const SNIPPET_IDS_KEY = "agentswarm:snippet_ids";
const SNIPPET_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SNIPPET_VARIABLE_MAX_COUNT = 100;
const SNIPPET_VARIABLE_NAME_MAX_LENGTH = 128;
const SNIPPET_VARIABLE_TEXT_MAX_LENGTH = 200;

const nowIso = (): string => new Date().toISOString();
const normalizeSnippetVariables = (value: unknown): SnippetVariable[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const variables: SnippetVariable[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name || name.length > SNIPPET_VARIABLE_NAME_MAX_LENGTH || !SNIPPET_VARIABLE_NAME_PATTERN.test(name) || seen.has(name)) {
      continue;
    }

    const type = record.type === "multiline" ? "multiline" : "text";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    variables.push({
      name,
      type,
      title: title.slice(0, SNIPPET_VARIABLE_TEXT_MAX_LENGTH),
      description: description.slice(0, SNIPPET_VARIABLE_TEXT_MAX_LENGTH)
    });
    seen.add(name);
    if (variables.length >= SNIPPET_VARIABLE_MAX_COUNT) {
      break;
    }
  }

  return variables;
};

export interface SnippetStore {
  createSnippet(input: CreateSnippetInput): Promise<Snippet>;
  listSnippets(): Promise<Snippet[]>;
  getSnippet(snippetId: string): Promise<Snippet | null>;
  updateSnippet(snippetId: string, input: UpdateSnippetInput): Promise<Snippet | null>;
  deleteSnippet(snippetId: string): Promise<boolean>;
}

export class RedisSnippetStore implements SnippetStore {
  constructor(
    private readonly redis: Redis,
    private readonly eventBus: EventBus
  ) {}

  private snippetKey(snippetId: string): string {
    return `${SNIPPET_KEY_PREFIX}${snippetId}`;
  }

  private buildSnippet(
    input: CreateSnippetInput | UpdateSnippetInput,
    current?: Pick<Snippet, "id" | "createdAt">
  ): Snippet {
    const timestamp = nowIso();
    return {
      id: current?.id ?? nanoid(),
      name: input.name.trim(),
      content: input.content.trim(),
      variables: normalizeSnippetVariables(input.variables),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
  }

  async createSnippet(input: CreateSnippetInput): Promise<Snippet> {
    const snippet = this.buildSnippet(input);
    await this.redis
      .multi()
      .set(this.snippetKey(snippet.id), JSON.stringify(snippet))
      .sadd(SNIPPET_IDS_KEY, snippet.id)
      .exec();
    await this.eventBus.publish({ type: "snippet:created", payload: snippet });
    return snippet;
  }

  async listSnippets(): Promise<Snippet[]> {
    const ids = await this.redis.smembers(SNIPPET_IDS_KEY);
    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.get(this.snippetKey(id));
    }

    const result = await pipeline.exec();
    const snippets: Snippet[] = [];
    for (const row of result ?? []) {
      const raw = row[1];
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw) as Snippet;
        snippets.push({ ...parsed, variables: normalizeSnippetVariables(parsed.variables) });
      }
    }

    return snippets.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getSnippet(snippetId: string): Promise<Snippet | null> {
    const raw = await this.redis.get(this.snippetKey(snippetId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Snippet;
    return { ...parsed, variables: normalizeSnippetVariables(parsed.variables) };
  }

  async updateSnippet(snippetId: string, input: UpdateSnippetInput): Promise<Snippet | null> {
    const current = await this.getSnippet(snippetId);
    if (!current) {
      return null;
    }

    const next = this.buildSnippet(input, current);
    await this.redis.set(this.snippetKey(snippetId), JSON.stringify(next));
    await this.eventBus.publish({ type: "snippet:updated", payload: next });
    return next;
  }

  async deleteSnippet(snippetId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.snippetKey(snippetId));
    if (!exists) {
      return false;
    }

    await this.redis.multi().del(this.snippetKey(snippetId)).srem(SNIPPET_IDS_KEY, snippetId).exec();
    await this.eventBus.publish({ type: "snippet:deleted", payload: { id: snippetId } });
    return true;
  }
}

export class PostgresSnippetStore implements SnippetStore {
  constructor(
    private readonly pool: Pool,
    private readonly eventBus: EventBus
  ) {}

  private buildSnippet(
    input: CreateSnippetInput | UpdateSnippetInput,
    current?: Pick<Snippet, "id" | "createdAt">
  ): Snippet {
    const timestamp = nowIso();
    return {
      id: current?.id ?? nanoid(),
      name: input.name.trim(),
      content: input.content.trim(),
      variables: normalizeSnippetVariables(input.variables),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
  }

  async createSnippet(input: CreateSnippetInput): Promise<Snippet> {
    const snippet = this.buildSnippet(input);
    await this.pool.query(
      `
        INSERT INTO snippets (id, name, content, created_at, updated_at, variables)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [snippet.id, snippet.name, snippet.content, snippet.createdAt, snippet.updatedAt, JSON.stringify(snippet.variables)]
    );
    await this.eventBus.publish({ type: "snippet:created", payload: snippet });
    return snippet;
  }

  async listSnippets(): Promise<Snippet[]> {
    const result = await this.pool.query(
      "SELECT id, name, content, variables, created_at, updated_at FROM snippets ORDER BY updated_at DESC"
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      content: String(row.content),
      variables: normalizeSnippetVariables(row.variables),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }));
  }

  async getSnippet(snippetId: string): Promise<Snippet | null> {
    const result = await this.pool.query(
      "SELECT id, name, content, variables, created_at, updated_at FROM snippets WHERE id = $1",
      [snippetId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: String(row.id),
          name: String(row.name),
          content: String(row.content),
          variables: normalizeSnippetVariables(row.variables),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at)
        }
      : null;
  }

  async updateSnippet(snippetId: string, input: UpdateSnippetInput): Promise<Snippet | null> {
    const current = await this.getSnippet(snippetId);
    if (!current) {
      return null;
    }

    const next = this.buildSnippet(input, current);
    await this.pool.query(
      `
        UPDATE snippets
        SET name = $2, content = $3, updated_at = $4, variables = $5::jsonb
        WHERE id = $1
      `,
      [snippetId, next.name, next.content, next.updatedAt, JSON.stringify(next.variables)]
    );
    await this.eventBus.publish({ type: "snippet:updated", payload: next });
    return next;
  }

  async deleteSnippet(snippetId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM snippets WHERE id = $1", [snippetId]);
    if (result.rowCount === 0) {
      return false;
    }

    await this.eventBus.publish({ type: "snippet:deleted", payload: { id: snippetId } });
    return true;
  }
}
