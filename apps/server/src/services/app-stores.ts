import type { CredentialStore } from "./credential-store.js";
import type { RepositoryStore } from "./repository-store.js";
import type { RoleStore } from "./role-store.js";
import type { SessionStore } from "./session-store.js";
import type { SettingsStore } from "./settings-store.js";
import type { SnippetStore } from "./snippet-store.js";
import type { SequenceStore } from "./sequence-store.js";
import type { TaskQueueStore } from "./task-queue-store.js";
import type { TaskDraftStore } from "./task-draft-store.js";
import type { TaskStore } from "./task-store.js";
import type { UserStore } from "./user-store.js";
import type { WebhookDeliveryStore } from "./webhook-delivery-store.js";
import type { GitHubOutboundQueueStore } from "./github-outbound-queue-store.js";

export type SupportedStoreBackend = "redis" | "postgres";

export interface DurableStoreBackends {
  taskStore: SupportedStoreBackend;
  snippetStore: SupportedStoreBackend;
  sequenceStore: SupportedStoreBackend;
  repositoryStore: SupportedStoreBackend;
  credentialStore: SupportedStoreBackend;
  roleStore: SupportedStoreBackend;
  userStore: SupportedStoreBackend;
  settingsStore: SupportedStoreBackend;
}

export interface AppStores {
  taskStore: TaskStore;
  taskDraftStore: TaskDraftStore;
  taskQueueStore: TaskQueueStore;
  githubOutboundQueueStore: GitHubOutboundQueueStore;
  webhookDeliveryStore: WebhookDeliveryStore;
  snippetStore: SnippetStore;
  sequenceStore: SequenceStore;
  repositoryStore: RepositoryStore;
  credentialStore: CredentialStore;
  roleStore: RoleStore;
  userStore: UserStore;
  sessionStore: SessionStore;
  settingsStore: SettingsStore;
}

export const usesPostgresBackends = (backends: DurableStoreBackends): boolean =>
  Object.values(backends).some((backend) => backend === "postgres");
