import type { Pool } from "pg";
import type { EventBus } from "../lib/events.js";
import type { RedisClients } from "../lib/redis.js";
import type { AppStores } from "./app-stores.js";
import { PostgresCredentialStore } from "./credential-store.js";
import { PostgresRepositoryStore } from "./repository-store.js";
import { PostgresRoleStore } from "./role-store.js";
import { RedisSessionStore } from "./session-store.js";
import { PostgresSettingsStore } from "./settings-store.js";
import { PostgresSnippetStore } from "./snippet-store.js";
import { RedisTaskQueueStore } from "./task-queue-store.js";
import { PostgresTaskStore } from "./task-store.js";
import { PostgresUserStore } from "./user-store.js";
import { RedisWebhookDeliveryStore } from "./webhook-delivery-store.js";

export const createPostgresStores = (
  pool: Pool,
  redisClients: RedisClients,
  eventBus: EventBus,
  sessionTtlDays: number
): AppStores => {
  const taskStore = new PostgresTaskStore(pool, eventBus);
  const taskQueueStore = new RedisTaskQueueStore(redisClients.command);
  const webhookDeliveryStore = new RedisWebhookDeliveryStore(redisClients.command);
  const snippetStore = new PostgresSnippetStore(pool, eventBus);
  const repositoryStore = new PostgresRepositoryStore(pool, eventBus);
  const credentialStore = new PostgresCredentialStore(pool);
  const roleStore = new PostgresRoleStore(pool);
  const userStore = new PostgresUserStore(pool, roleStore);
  const sessionStore = new RedisSessionStore(redisClients.command, sessionTtlDays);
  const settingsStore = new PostgresSettingsStore(pool, eventBus, credentialStore);

  return {
    taskStore,
    taskQueueStore,
    webhookDeliveryStore,
    snippetStore,
    repositoryStore,
    credentialStore,
    roleStore,
    userStore,
    sessionStore,
    settingsStore
  };
};
