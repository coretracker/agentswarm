import type { Pool } from "pg";
import type { EventBus } from "../lib/events.js";
import type { RedisClients } from "../lib/redis.js";
import type { AppStores, DurableStoreBackends } from "./app-stores.js";
import { PostgresCredentialStore, RedisCredentialStore } from "./credential-store.js";
import { PostgresRepositoryStore, RedisRepositoryStore } from "./repository-store.js";
import { PostgresRoleStore, RedisRoleStore } from "./role-store.js";
import { RedisSessionStore } from "./session-store.js";
import { PostgresSettingsStore, RedisSettingsStore } from "./settings-store.js";
import { PostgresSnippetStore, RedisSnippetStore } from "./snippet-store.js";
import { RedisTaskQueueStore } from "./task-queue-store.js";
import { PostgresTaskStore, RedisTaskStore } from "./task-store.js";
import { PostgresUserStore, RedisUserStore } from "./user-store.js";
import { RedisWebhookDeliveryStore } from "./webhook-delivery-store.js";

interface CreateAppStoresOptions {
  pool: Pool | null;
  redisClients: RedisClients;
  eventBus: EventBus;
  sessionTtlDays: number;
  backends: DurableStoreBackends;
}

const requirePool = (pool: Pool | null, storeName: keyof DurableStoreBackends): Pool => {
  if (pool) {
    return pool;
  }

  throw new Error(`Postgres backend selected for ${storeName}, but no Postgres pool is available.`);
};

export const createAppStores = ({
  pool,
  redisClients,
  eventBus,
  sessionTtlDays,
  backends
}: CreateAppStoresOptions): AppStores => {
  const redisRoleStore = backends.roleStore === "redis" || backends.userStore === "redis"
    ? new RedisRoleStore(redisClients.command)
    : null;
  const postgresRoleStore = backends.roleStore === "postgres" || backends.userStore === "postgres"
    ? new PostgresRoleStore(requirePool(pool, "roleStore"))
    : null;
  const roleStore = backends.roleStore === "postgres"
    ? (postgresRoleStore ?? new PostgresRoleStore(requirePool(pool, "roleStore")))
    : (redisRoleStore ?? new RedisRoleStore(redisClients.command));

  const redisCredentialStore = backends.credentialStore === "redis" || backends.settingsStore === "redis"
    ? new RedisCredentialStore(redisClients.command)
    : null;
  const postgresCredentialStore = backends.credentialStore === "postgres" || backends.settingsStore === "postgres"
    ? new PostgresCredentialStore(requirePool(pool, "credentialStore"))
    : null;
  const credentialStore = backends.credentialStore === "postgres"
    ? (postgresCredentialStore ?? new PostgresCredentialStore(requirePool(pool, "credentialStore")))
    : (redisCredentialStore ?? new RedisCredentialStore(redisClients.command));

  const taskStore = backends.taskStore === "postgres"
    ? new PostgresTaskStore(requirePool(pool, "taskStore"), eventBus)
    : new RedisTaskStore(redisClients.command, eventBus);
  const snippetStore = backends.snippetStore === "postgres"
    ? new PostgresSnippetStore(requirePool(pool, "snippetStore"), eventBus)
    : new RedisSnippetStore(redisClients.command, eventBus);
  const repositoryStore = backends.repositoryStore === "postgres"
    ? new PostgresRepositoryStore(requirePool(pool, "repositoryStore"), eventBus)
    : new RedisRepositoryStore(redisClients.command, eventBus);
  const userStore = backends.userStore === "postgres"
    ? new PostgresUserStore(requirePool(pool, "userStore"), roleStore, repositoryStore)
    : new RedisUserStore(redisClients.command, roleStore, repositoryStore);
  const settingsStore = backends.settingsStore === "postgres"
    ? new PostgresSettingsStore(requirePool(pool, "settingsStore"), eventBus, credentialStore)
    : new RedisSettingsStore(redisClients.command, eventBus, credentialStore);
  const taskQueueStore = new RedisTaskQueueStore(redisClients.command);
  const webhookDeliveryStore = new RedisWebhookDeliveryStore(redisClients.command);
  const sessionStore = new RedisSessionStore(redisClients.command, sessionTtlDays);

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
