import type { CredentialStore } from "./credential-store.js";
import type { RepositoryStore } from "./repository-store.js";
import type { RoleStore } from "./role-store.js";
import type { SessionStore } from "./session-store.js";
import type { SettingsStore } from "./settings-store.js";
import type { SnippetStore } from "./snippet-store.js";
import type { TaskQueueStore } from "./task-queue-store.js";
import type { TaskStore } from "./task-store.js";
import type { UserStore } from "./user-store.js";
import type { WebhookDeliveryStore } from "./webhook-delivery-store.js";
import type { PersonalAccessTokenStore } from "./personal-access-token-store.js";

export interface AppStores {
  taskStore: TaskStore;
  taskQueueStore: TaskQueueStore;
  webhookDeliveryStore: WebhookDeliveryStore;
  snippetStore: SnippetStore;
  repositoryStore: RepositoryStore;
  credentialStore: CredentialStore;
  roleStore: RoleStore;
  userStore: UserStore;
  personalAccessTokenStore: PersonalAccessTokenStore;
  sessionStore: SessionStore;
  settingsStore: SettingsStore;
}
