import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type { UpdateCredentialSettingsInput } from "@agentswarm/shared-types";
import { env } from "../config/env.js";

const CREDENTIALS_KEY = "agentswarm:credential_settings";
const nowIso = (): string => new Date().toISOString();

interface StoredCredentials {
  githubToken: string | null;
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  slackBotToken: string | null;
  slackSigningSecret: string | null;
  slackSocketModeToken: string | null;
  codexAuthJsonByUserId: Record<string, string>;
}

interface EncryptedPayload {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface RuntimeCredentials {
  githubToken: string | null;
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  slackBotToken: string | null;
  slackSigningSecret: string | null;
  slackSocketModeToken: string | null;
  codexAuthJson?: string | null;
}

export interface CredentialStatus {
  githubTokenConfigured: boolean;
  openaiApiKeyConfigured: boolean;
  anthropicApiKeyConfigured: boolean;
  slackBotTokenConfigured: boolean;
  slackSigningSecretConfigured: boolean;
  slackSocketModeTokenConfigured: boolean;
}

export interface CredentialStore {
  getCredentials(): Promise<RuntimeCredentials>;
  getCredentialStatus(): Promise<CredentialStatus>;
  updateCredentials(input: UpdateCredentialSettingsInput): Promise<CredentialStatus>;
  getCodexAuthJsonForUser(userId: string): Promise<string | null>;
  setCodexAuthJsonForUser(userId: string, codexAuthJson: string | null): Promise<void>;
  hasCodexAuthJsonForUser(userId: string): Promise<boolean>;
}

export class RedisCredentialStore implements CredentialStore {
  private keyPromise: Promise<Buffer> | null = null;

  constructor(private readonly redis: Redis) {}

  private async getEncryptionKey(): Promise<Buffer> {
    if (this.keyPromise) {
      return this.keyPromise;
    }

    this.keyPromise = (async () => {
      await mkdir(path.dirname(env.SECRET_KEY_PATH), { recursive: true });

      try {
        const existing = (await readFile(env.SECRET_KEY_PATH, "utf8")).trim();
        const key = Buffer.from(existing, "base64");
        if (key.length === 32) {
          return key;
        }
      } catch {
        // Fall through and create a new key.
      }

      const key = randomBytes(32);
      await writeFile(env.SECRET_KEY_PATH, key.toString("base64"), { encoding: "utf8", mode: 0o600 });
      await chmod(env.SECRET_KEY_PATH, 0o600);
      return key;
    })();

    return this.keyPromise;
  }

  private async encrypt(value: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const payload: EncryptedPayload = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
    return JSON.stringify(payload);
  }

  private async decrypt(value: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const payload = JSON.parse(value) as EncryptedPayload;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final()
    ]);
    return plaintext.toString("utf8");
  }

  private normalizeCodexAuthJsonByUserId(value: Record<string, unknown> | undefined): Record<string, string> {
    const next: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value ?? {})) {
      const userId = key.trim();
      const authJson = typeof raw === "string" ? raw.trim() : "";
      if (!userId || !authJson) {
        continue;
      }
      next[userId] = authJson;
    }
    return next;
  }

  private async readStoredCredentials(): Promise<StoredCredentials> {
    const raw = await this.redis.get(CREDENTIALS_KEY);
    if (!raw) {
      return {
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        slackBotToken: null,
        slackSigningSecret: null,
        slackSocketModeToken: null,
        codexAuthJsonByUserId: {}
      };
    }

    try {
      const decrypted = await this.decrypt(raw);
      const parsed = JSON.parse(decrypted) as Partial<StoredCredentials> & {
        codexAuthJsonByUserId?: Record<string, unknown>;
      };
      return {
        githubToken: parsed.githubToken?.trim() || null,
        openaiApiKey: parsed.openaiApiKey?.trim() || null,
        anthropicApiKey: parsed.anthropicApiKey?.trim() || null,
        slackBotToken: parsed.slackBotToken?.trim() || null,
        slackSigningSecret: parsed.slackSigningSecret?.trim() || null,
        slackSocketModeToken: parsed.slackSocketModeToken?.trim() || null,
        codexAuthJsonByUserId: this.normalizeCodexAuthJsonByUserId(parsed.codexAuthJsonByUserId)
      };
    } catch {
      return {
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        slackBotToken: null,
        slackSigningSecret: null,
        slackSocketModeToken: null,
        codexAuthJsonByUserId: {}
      };
    }
  }

  private async writeStoredCredentials(next: StoredCredentials): Promise<void> {
    if (
      !next.githubToken &&
      !next.openaiApiKey &&
      !next.anthropicApiKey &&
      !next.slackBotToken &&
      !next.slackSigningSecret &&
      !next.slackSocketModeToken &&
      Object.keys(next.codexAuthJsonByUserId).length === 0
    ) {
      await this.redis.del(CREDENTIALS_KEY);
      return;
    }

    const encrypted = await this.encrypt(JSON.stringify(next));
    await this.redis.set(CREDENTIALS_KEY, encrypted);
  }

  async getCredentials(): Promise<RuntimeCredentials> {
    const current = await this.readStoredCredentials();
    return {
      githubToken: current.githubToken,
      openaiApiKey: current.openaiApiKey,
      anthropicApiKey: current.anthropicApiKey,
      slackBotToken: current.slackBotToken,
      slackSigningSecret: current.slackSigningSecret,
      slackSocketModeToken: current.slackSocketModeToken,
      codexAuthJson: null
    };
  }

  async getCredentialStatus(): Promise<CredentialStatus> {
    const credentials = await this.getCredentials();
    return {
      githubTokenConfigured: Boolean(credentials.githubToken),
      openaiApiKeyConfigured: Boolean(credentials.openaiApiKey),
      anthropicApiKeyConfigured: Boolean(credentials.anthropicApiKey),
      slackBotTokenConfigured: Boolean(credentials.slackBotToken),
      slackSigningSecretConfigured: Boolean(credentials.slackSigningSecret),
      slackSocketModeTokenConfigured: Boolean(credentials.slackSocketModeToken)
    };
  }

  async updateCredentials(input: UpdateCredentialSettingsInput): Promise<CredentialStatus> {
    const current = await this.readStoredCredentials();
    const next: StoredCredentials = {
      githubToken: input.clearGithubToken
        ? null
        : input.githubToken?.trim()
          ? input.githubToken.trim()
          : current.githubToken,
      openaiApiKey: input.clearOpenAiApiKey
        ? null
        : input.openaiApiKey?.trim()
          ? input.openaiApiKey.trim()
          : current.openaiApiKey,
      anthropicApiKey: input.clearAnthropicApiKey
        ? null
        : input.anthropicApiKey?.trim()
          ? input.anthropicApiKey.trim()
          : current.anthropicApiKey,
      slackBotToken: input.clearSlackBotToken
        ? null
        : input.slackBotToken?.trim()
          ? input.slackBotToken.trim()
          : current.slackBotToken,
      slackSigningSecret: input.clearSlackSigningSecret
        ? null
        : input.slackSigningSecret?.trim()
          ? input.slackSigningSecret.trim()
          : current.slackSigningSecret,
      slackSocketModeToken: input.clearSlackSocketModeToken
        ? null
        : input.slackSocketModeToken?.trim()
          ? input.slackSocketModeToken.trim()
          : current.slackSocketModeToken,
      codexAuthJsonByUserId: current.codexAuthJsonByUserId
    };
    await this.writeStoredCredentials(next);

    return this.getCredentialStatus();
  }

  async getCodexAuthJsonForUser(userId: string): Promise<string | null> {
    const key = userId.trim();
    if (!key) {
      return null;
    }
    const current = await this.readStoredCredentials();
    return current.codexAuthJsonByUserId[key]?.trim() || null;
  }

  async setCodexAuthJsonForUser(userId: string, codexAuthJson: string | null): Promise<void> {
    const key = userId.trim();
    if (!key) {
      return;
    }
    const current = await this.readStoredCredentials();
    const nextByUserId = { ...current.codexAuthJsonByUserId };
    const normalized = codexAuthJson?.trim() || null;
    if (normalized) {
      nextByUserId[key] = normalized;
    } else {
      delete nextByUserId[key];
    }
    await this.writeStoredCredentials({
      ...current,
      codexAuthJsonByUserId: nextByUserId
    });
  }

  async hasCodexAuthJsonForUser(userId: string): Promise<boolean> {
    return Boolean(await this.getCodexAuthJsonForUser(userId));
  }
}

export class PostgresCredentialStore implements CredentialStore {
  private keyPromise: Promise<Buffer> | null = null;

  constructor(private readonly pool: Pool) {}

  private async getEncryptionKey(): Promise<Buffer> {
    if (this.keyPromise) {
      return this.keyPromise;
    }

    this.keyPromise = (async () => {
      await mkdir(path.dirname(env.SECRET_KEY_PATH), { recursive: true });

      try {
        const existing = (await readFile(env.SECRET_KEY_PATH, "utf8")).trim();
        const key = Buffer.from(existing, "base64");
        if (key.length === 32) {
          return key;
        }
      } catch {
        // Fall through and create a new key.
      }

      const key = randomBytes(32);
      await writeFile(env.SECRET_KEY_PATH, key.toString("base64"), { encoding: "utf8", mode: 0o600 });
      await chmod(env.SECRET_KEY_PATH, 0o600);
      return key;
    })();

    return this.keyPromise;
  }

  private async encrypt(value: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const payload: EncryptedPayload = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
    return JSON.stringify(payload);
  }

  private async decrypt(value: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const payload = JSON.parse(value) as EncryptedPayload;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final()
    ]);
    return plaintext.toString("utf8");
  }

  private normalizeCodexAuthJsonByUserId(value: Record<string, unknown> | undefined): Record<string, string> {
    const next: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value ?? {})) {
      const userId = key.trim();
      const authJson = typeof raw === "string" ? raw.trim() : "";
      if (!userId || !authJson) {
        continue;
      }
      next[userId] = authJson;
    }
    return next;
  }

  private async readStoredCredentials(): Promise<StoredCredentials> {
    const result = await this.pool.query<{ payload_encrypted: string }>(
      "SELECT payload_encrypted FROM credentials WHERE singleton_id = 1"
    );

    const row = result.rows[0];
    if (!row) {
      return {
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        slackBotToken: null,
        slackSigningSecret: null,
        slackSocketModeToken: null,
        codexAuthJsonByUserId: {}
      };
    }

    try {
      const decrypted = await this.decrypt(row.payload_encrypted);
      const parsed = JSON.parse(decrypted) as Partial<StoredCredentials> & {
        codexAuthJsonByUserId?: Record<string, unknown>;
      };
      return {
        githubToken: parsed.githubToken?.trim() || null,
        openaiApiKey: parsed.openaiApiKey?.trim() || null,
        anthropicApiKey: parsed.anthropicApiKey?.trim() || null,
        slackBotToken: parsed.slackBotToken?.trim() || null,
        slackSigningSecret: parsed.slackSigningSecret?.trim() || null,
        slackSocketModeToken: parsed.slackSocketModeToken?.trim() || null,
        codexAuthJsonByUserId: this.normalizeCodexAuthJsonByUserId(parsed.codexAuthJsonByUserId)
      };
    } catch {
      return {
        githubToken: null,
        openaiApiKey: null,
        anthropicApiKey: null,
        slackBotToken: null,
        slackSigningSecret: null,
        codexAuthJsonByUserId: {}
      };
    }
  }

  private async writeStoredCredentials(next: StoredCredentials): Promise<void> {
    if (
      !next.githubToken &&
      !next.openaiApiKey &&
      !next.anthropicApiKey &&
      !next.slackBotToken &&
      !next.slackSigningSecret &&
      !next.slackSocketModeToken &&
      Object.keys(next.codexAuthJsonByUserId).length === 0
    ) {
      await this.pool.query("DELETE FROM credentials WHERE singleton_id = 1");
      return;
    }

    const encrypted = await this.encrypt(JSON.stringify(next));
    await this.pool.query(
      `
          INSERT INTO credentials (
            singleton_id,
            payload_encrypted,
            updated_at
          )
          VALUES (1, $1, $2)
          ON CONFLICT (singleton_id) DO UPDATE
          SET
            payload_encrypted = EXCLUDED.payload_encrypted,
            updated_at = EXCLUDED.updated_at
        `,
      [encrypted, nowIso()]
    );
  }

  async getCredentials(): Promise<RuntimeCredentials> {
    const current = await this.readStoredCredentials();
    return {
      githubToken: current.githubToken,
      openaiApiKey: current.openaiApiKey,
      anthropicApiKey: current.anthropicApiKey,
      slackBotToken: current.slackBotToken,
      slackSigningSecret: current.slackSigningSecret,
      slackSocketModeToken: current.slackSocketModeToken,
      codexAuthJson: null
    };
  }

  async getCredentialStatus(): Promise<CredentialStatus> {
    const credentials = await this.getCredentials();
    return {
      githubTokenConfigured: Boolean(credentials.githubToken),
      openaiApiKeyConfigured: Boolean(credentials.openaiApiKey),
      anthropicApiKeyConfigured: Boolean(credentials.anthropicApiKey),
      slackBotTokenConfigured: Boolean(credentials.slackBotToken),
      slackSigningSecretConfigured: Boolean(credentials.slackSigningSecret),
      slackSocketModeTokenConfigured: Boolean(credentials.slackSocketModeToken)
    };
  }

  async updateCredentials(input: UpdateCredentialSettingsInput): Promise<CredentialStatus> {
    const current = await this.readStoredCredentials();
    const next: StoredCredentials = {
      githubToken: input.clearGithubToken
        ? null
        : input.githubToken?.trim()
          ? input.githubToken.trim()
          : current.githubToken,
      openaiApiKey: input.clearOpenAiApiKey
        ? null
        : input.openaiApiKey?.trim()
          ? input.openaiApiKey.trim()
          : current.openaiApiKey,
      anthropicApiKey: input.clearAnthropicApiKey
        ? null
        : input.anthropicApiKey?.trim()
          ? input.anthropicApiKey.trim()
          : current.anthropicApiKey,
      slackBotToken: input.clearSlackBotToken
        ? null
        : input.slackBotToken?.trim()
          ? input.slackBotToken.trim()
          : current.slackBotToken,
      slackSigningSecret: input.clearSlackSigningSecret
        ? null
        : input.slackSigningSecret?.trim()
          ? input.slackSigningSecret.trim()
          : current.slackSigningSecret,
      slackSocketModeToken: input.clearSlackSocketModeToken
        ? null
        : input.slackSocketModeToken?.trim()
          ? input.slackSocketModeToken.trim()
          : current.slackSocketModeToken,
      codexAuthJsonByUserId: current.codexAuthJsonByUserId
    };
    await this.writeStoredCredentials(next);

    return this.getCredentialStatus();
  }

  async getCodexAuthJsonForUser(userId: string): Promise<string | null> {
    const key = userId.trim();
    if (!key) {
      return null;
    }
    const current = await this.readStoredCredentials();
    return current.codexAuthJsonByUserId[key]?.trim() || null;
  }

  async setCodexAuthJsonForUser(userId: string, codexAuthJson: string | null): Promise<void> {
    const key = userId.trim();
    if (!key) {
      return;
    }
    const current = await this.readStoredCredentials();
    const nextByUserId = { ...current.codexAuthJsonByUserId };
    const normalized = codexAuthJson?.trim() || null;
    if (normalized) {
      nextByUserId[key] = normalized;
    } else {
      delete nextByUserId[key];
    }
    await this.writeStoredCredentials({
      ...current,
      codexAuthJsonByUserId: nextByUserId
    });
  }

  async hasCodexAuthJsonForUser(userId: string): Promise<boolean> {
    return Boolean(await this.getCodexAuthJsonForUser(userId));
  }
}
