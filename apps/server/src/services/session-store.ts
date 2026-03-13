import { randomBytes } from "node:crypto";
import type Redis from "ioredis";

const SESSION_KEY_PREFIX = "agentswarm:session:";
const USER_SESSION_IDS_KEY_PREFIX = "agentswarm:user_session_ids:";

export interface SessionRecord {
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

const nowIso = (): string => new Date().toISOString();

export class SessionStore {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: Redis,
    ttlDays: number
  ) {
    this.ttlSeconds = Math.max(1, Math.round(ttlDays * 24 * 60 * 60));
  }

  private sessionKey(token: string): string {
    return `${SESSION_KEY_PREFIX}${token}`;
  }

  private userSessionIdsKey(userId: string): string {
    return `${USER_SESSION_IDS_KEY_PREFIX}${userId}`;
  }

  async createSession(userId: string): Promise<SessionRecord> {
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000).toISOString();
    const record: SessionRecord = {
      token: randomBytes(32).toString("hex"),
      userId,
      expiresAt,
      createdAt
    };

    await this.redis
      .multi()
      .set(this.sessionKey(record.token), JSON.stringify(record), "EX", this.ttlSeconds)
      .sadd(this.userSessionIdsKey(userId), record.token)
      .expire(this.userSessionIdsKey(userId), this.ttlSeconds)
      .exec();

    return record;
  }

  async getSession(token: string): Promise<SessionRecord | null> {
    const raw = await this.redis.get(this.sessionKey(token));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as SessionRecord;
  }

  async deleteSession(token: string): Promise<void> {
    const current = await this.getSession(token);
    if (!current) {
      await this.redis.del(this.sessionKey(token));
      return;
    }

    await this.redis
      .multi()
      .del(this.sessionKey(token))
      .srem(this.userSessionIdsKey(current.userId), token)
      .exec();
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    const tokens = await this.redis.smembers(this.userSessionIdsKey(userId));
    const pipeline = this.redis.multi().del(this.userSessionIdsKey(userId));

    for (const token of tokens) {
      pipeline.del(this.sessionKey(token));
    }

    await pipeline.exec();
  }
}
