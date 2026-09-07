import type { Pool } from "pg";
import type { EventBus } from "../lib/events.js";
import type { RedisClients } from "../lib/redis.js";
import type { AppStores } from "./app-stores.js";
import { PostgresCredentialStore } from "./credential-store.js";
import { PostgresIntegrationRuleStore } from "./integration-rule-store.js";
import { PostgresRepositoryStore } from "./repository-store.js";
import { PostgresRoleStore } from "./role-store.js";
import { RedisSessionStore } from "./session-store.js";
import { PostgresSettingsStore } from "./settings-store.js";
import { RedisTaskQueueStore } from "./task-queue-store.js";
import { PostgresTaskStore } from "./task-store.js";
import { PostgresUserStore } from "./user-store.js";
import { RedisWebhookDeliveryStore } from "./webhook-delivery-store.js";
import { PostgresWebhookInboxStore } from "./webhook-inbox-store.js";
import { PostgresPersonalAccessTokenStore } from "./personal-access-token-store.js";
import { TeamStore } from "./team-store.js";
import { PostgresAskTemplateStore } from "./ask-template-store.js";

export const createPostgresStores = (
  pool: Pool,
  redisClients: RedisClients,
  eventBus: EventBus,
  sessionTtlDays: number
): AppStores => {
  const taskStore = new PostgresTaskStore(pool, eventBus);
  const taskQueueStore = new RedisTaskQueueStore(redisClients.command);
  const webhookDeliveryStore = new RedisWebhookDeliveryStore(redisClients.command);
  const repositoryStore = new PostgresRepositoryStore(pool, eventBus);
  const credentialStore = new PostgresCredentialStore(pool);
  const roleStore = new PostgresRoleStore(pool);
  const userStore = new PostgresUserStore(pool, roleStore, repositoryStore);
  const teamStore = new TeamStore(pool);
  const askTemplateStore = new PostgresAskTemplateStore(pool);
  const personalAccessTokenStore = new PostgresPersonalAccessTokenStore(pool, userStore);
  const sessionStore = new RedisSessionStore(redisClients.command, sessionTtlDays);
  const settingsStore = new PostgresSettingsStore(pool, eventBus, credentialStore);
  const integrationRuleStore = new PostgresIntegrationRuleStore(pool);
  const webhookInboxStore = new PostgresWebhookInboxStore(pool);

  return {
    taskStore,
    taskQueueStore,
    webhookDeliveryStore,
    repositoryStore,
    credentialStore,
    roleStore,
    userStore,
    teamStore,
    personalAccessTokenStore,
    sessionStore,
    settingsStore,
    integrationRuleStore,
    webhookInboxStore,
    askTemplateStore
  };
};
