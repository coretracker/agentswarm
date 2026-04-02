import { nanoid } from "nanoid";
import type Redis from "ioredis";
import type { CreateSnippetInput, Snippet, UpdateSnippetInput } from "@agentswarm/shared-types";
import { EventBus } from "../lib/events.js";

const SNIPPET_KEY_PREFIX = "agentswarm:snippet:";
const SNIPPET_IDS_KEY = "agentswarm:snippet_ids";

const nowIso = (): string => new Date().toISOString();

export class SnippetStore {
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
        snippets.push(JSON.parse(raw) as Snippet);
      }
    }

    return snippets.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getSnippet(snippetId: string): Promise<Snippet | null> {
    const raw = await this.redis.get(this.snippetKey(snippetId));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as Snippet;
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
