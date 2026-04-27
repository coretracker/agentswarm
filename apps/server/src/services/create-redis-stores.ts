import type { EventBus } from "../lib/events.js";
import type { RedisClients } from "../lib/redis.js";
import type { AppStores } from "./app-stores.js";
import type { CredentialStore } from "./credential-store.js";
import { RedisCredentialStore } from "./credential-store.js";
import type { RepositoryStore } from "./repository-store.js";
import { RedisRepositoryStore } from "./repository-store.js";
import type { RoleStore } from "./role-store.js";
import { RedisRoleStore } from "./role-store.js";
import type { SessionStore } from "./session-store.js";
import { RedisSessionStore } from "./session-store.js";
import type { SettingsStore } from "./settings-store.js";
import { RedisSettingsStore } from "./settings-store.js";
import type { SnippetStore } from "./snippet-store.js";
import { RedisSnippetStore } from "./snippet-store.js";
import type { TaskQueueStore } from "./task-queue-store.js";
import { RedisTaskQueueStore } from "./task-queue-store.js";
import type { TaskStore } from "./task-store.js";
import { RedisTaskStore } from "./task-store.js";
import type { UserStore } from "./user-store.js";
import { RedisUserStore } from "./user-store.js";
import { RedisWebhookDeliveryStore } from "./webhook-delivery-store.js";

export const createRedisStores = (
  redisClients: RedisClients,
  eventBus: EventBus,
  sessionTtlDays: number
): AppStores => {
  const taskStore = new RedisTaskStore(redisClients.command, eventBus);
  const taskQueueStore = new RedisTaskQueueStore(redisClients.command);
  const webhookDeliveryStore = new RedisWebhookDeliveryStore(redisClients.command);
  const snippetStore = new RedisSnippetStore(redisClients.command, eventBus);
  const repositoryStore = new RedisRepositoryStore(redisClients.command, eventBus);
  const credentialStore = new RedisCredentialStore(redisClients.command);
  const roleStore = new RedisRoleStore(redisClients.command);
  const userStore = new RedisUserStore(redisClients.command, roleStore, repositoryStore);
  const sessionStore = new RedisSessionStore(redisClients.command, sessionTtlDays);
  const settingsStore = new RedisSettingsStore(redisClients.command, eventBus, credentialStore);

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
