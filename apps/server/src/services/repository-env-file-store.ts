import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";

interface EncryptedPayload {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export class RepositoryEnvFileStore {
  private static keyPromise: Promise<Buffer> | null = null;

  private async getEncryptionKey(): Promise<Buffer> {
    if (RepositoryEnvFileStore.keyPromise) {
      return RepositoryEnvFileStore.keyPromise;
    }

    RepositoryEnvFileStore.keyPromise = (async () => {
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

    return RepositoryEnvFileStore.keyPromise;
  }

  private async encrypt(value: Buffer): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
    const payload: EncryptedPayload = {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
    return JSON.stringify(payload);
  }

  private async decrypt(value: string): Promise<Buffer> {
    const key = await this.getEncryptionKey();
    const payload = JSON.parse(value) as EncryptedPayload;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final()
    ]);
  }

  private resolveFilePath(fileId: string): string {
    if (!FILE_ID_PATTERN.test(fileId)) {
      throw new Error("Invalid repository env file identifier.");
    }
    return path.join(env.REPOSITORY_ENV_FILE_STORE_ROOT, `${fileId}.json`);
  }

  async saveFile(content: Buffer): Promise<{ fileId: string; sizeBytes: number }> {
    const fileId = nanoid();
    const encrypted = await this.encrypt(content);
    await mkdir(env.REPOSITORY_ENV_FILE_STORE_ROOT, { recursive: true, mode: 0o700 });
    await chmod(env.REPOSITORY_ENV_FILE_STORE_ROOT, 0o700).catch(() => undefined);

    const finalPath = this.resolveFilePath(fileId);
    const tempPath = `${finalPath}.tmp-${nanoid(6)}`;
    await writeFile(tempPath, encrypted, { encoding: "utf8", mode: 0o600 });
    await chmod(tempPath, 0o600).catch(() => undefined);
    await rename(tempPath, finalPath);
    await chmod(finalPath, 0o600).catch(() => undefined);

    return { fileId, sizeBytes: content.byteLength };
  }

  async readFile(fileId: string): Promise<Buffer | null> {
    try {
      const raw = await readFile(this.resolveFilePath(fileId), "utf8");
      return this.decrypt(raw);
    } catch {
      return null;
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      await rm(this.resolveFilePath(fileId), { force: true });
    } catch {
      // Ignore.
    }
  }
}
