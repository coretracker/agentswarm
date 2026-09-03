import type { CredentialStore } from "./credential-store.js";
import type { IntegrationRuleStore } from "./integration-rule-store.js";
import type { RepositoryStore } from "./repository-store.js";
import type { RoleStore } from "./role-store.js";
import type { SessionStore } from "./session-store.js";
import type { SettingsStore } from "./settings-store.js";
import type { TaskQueueStore } from "./task-queue-store.js";
import type { TaskStore } from "./task-store.js";
import type { UserStore } from "./user-store.js";
import type { TeamStore } from "./team-store.js";
import type { WebhookDeliveryStore } from "./webhook-delivery-store.js";
import type { WebhookInboxStore } from "./webhook-inbox-store.js";
import type { PersonalAccessTokenStore } from "./personal-access-token-store.js";

export interface AppStores {
  taskStore: TaskStore;
  taskQueueStore: TaskQueueStore;
  webhookDeliveryStore: WebhookDeliveryStore;
  repositoryStore: RepositoryStore;
  credentialStore: CredentialStore;
  roleStore: RoleStore;
  userStore: UserStore;
  teamStore: TeamStore;
  personalAccessTokenStore: PersonalAccessTokenStore;
  sessionStore: SessionStore;
  settingsStore: SettingsStore;
  integrationRuleStore: IntegrationRuleStore;
  webhookInboxStore: WebhookInboxStore;
}
