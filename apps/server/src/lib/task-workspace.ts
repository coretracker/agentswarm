import path from "node:path";
import {
  TASK_WORKSPACE_REPOSITORIES_DIR_NAME,
  TASK_WORKSPACE_ROOT_MOUNT_NAME,
  normalizeTaskRepositoryMountAlias,
  normalizeTaskRepositoryMountName,
  type Repository,
  type Task,
  type TaskAttachedRepository,
  type TaskAttachedRepositoryInput,
  type TaskWorkspaceMap,
  type TaskWorkspaceRepositoryMount
} from "@agentswarm/shared-types";

export const TASK_WORKSPACE_ROOT_PATH = "/workspace";
export const TASK_WORKSPACE_REPOSITORIES_PATH = path.posix.join(TASK_WORKSPACE_ROOT_PATH, TASK_WORKSPACE_REPOSITORIES_DIR_NAME);

export interface ResolvedTaskWorkspaceAttachment extends TaskWorkspaceRepositoryMount {
  repositoryName: string;
  repositoryUrl: string;
  repositoryDefaultBranch: string;
  mountPath: string;
}

export interface ResolvedTaskWorkspaceMap extends TaskWorkspaceMap {
  attachedRepositories: ResolvedTaskWorkspaceAttachment[];
}

export interface ValidateTaskAttachmentsOptions {
  rootRepositoryId: string;
  currentAttachments?: TaskAttachedRepository[] | null;
  allowExistingAttachmentUpdates?: boolean;
  hasTaskRun?: boolean;
}

export interface TaskAttachmentValidationError {
  message: string;
}

const RESERVED_ALIAS_LABELS = new Set(["", "root", "repos", "workspace"]);
const TASK_WORKSPACE_ENV_VAR_SAFE_PATTERN = /[^A-Za-z0-9]+/g;

const isString = (value: unknown): value is string => typeof value === "string";

const normalizePurpose = (value: unknown): string | null => {
  if (!isString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : null;
};

const normalizeAccessMode = (value: unknown): "read-only" | null => {
  if (value === undefined || value === null) {
    return "read-only";
  }
  return value === "read-only" ? "read-only" : null;
};

export function normalizeTaskAttachedRepositoryInput(value: unknown): TaskAttachedRepositoryInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const repositoryId = isString(raw.repositoryId) ? raw.repositoryId.trim() : "";
  const mountName = isString(raw.mountName) ? normalizeTaskRepositoryMountName(raw.mountName) : null;
  const accessMode = normalizeAccessMode(raw.accessMode);
  const purpose = normalizePurpose(raw.purpose);

  if (!repositoryId || !mountName || !accessMode) {
    return null;
  }

  return {
    repositoryId,
    mountName,
    accessMode,
    ...(purpose !== null ? { purpose } : {})
  };
}

export function validateTaskAttachedRepositoriesInput(
  attachments: unknown,
  options: ValidateTaskAttachmentsOptions
): { ok: true; attachments: TaskAttachedRepository[] } | { ok: false; message: string } {
  if (!Array.isArray(attachments)) {
    return { ok: false, message: "Attached repositories must be an array." };
  }

  const normalized = attachments.map(normalizeTaskAttachedRepositoryInput);
  if (normalized.some((item) => item === null)) {
    return { ok: false, message: "Attached repositories contain invalid entries." };
  }

  const currentAttachments = options.currentAttachments ?? [];
  const nextAttachments = normalized as TaskAttachedRepositoryInput[];
  const seenRepositoryIds = new Set<string>();
  const seenMountNames = new Set<string>();
  const seenAliases = new Set<string>();

  for (const attachment of nextAttachments) {
    if (attachment.repositoryId === options.rootRepositoryId) {
      return { ok: false, message: "The root repository cannot be attached as a secondary repository." };
    }
    if (seenRepositoryIds.has(attachment.repositoryId)) {
      return { ok: false, message: `Repository ${attachment.repositoryId} is attached more than once.` };
    }
    if (seenMountNames.has(attachment.mountName)) {
      return { ok: false, message: `Mount name ${attachment.mountName} is used more than once.` };
    }

    const alias = normalizeTaskRepositoryMountAlias(attachment.mountName);
    if (!alias || RESERVED_ALIAS_LABELS.has(alias)) {
      return { ok: false, message: `Mount name ${attachment.mountName} is reserved or ambiguous.` };
    }
    if (seenAliases.has(alias)) {
      return { ok: false, message: `Mount name ${attachment.mountName} collides with another attachment alias.` };
    }

    seenRepositoryIds.add(attachment.repositoryId);
    seenMountNames.add(attachment.mountName);
    seenAliases.add(alias);
  }

  if (!options.allowExistingAttachmentUpdates) {
    const currentByRepositoryId = new Map(currentAttachments.map((attachment) => [attachment.repositoryId, attachment]));
    for (const current of currentAttachments) {
      const next = nextAttachments.find((attachment) => attachment.repositoryId === current.repositoryId);
      if (!next) {
        return { ok: false, message: "Existing attached repositories cannot be removed after the task has run." };
      }
      if (next.mountName !== current.mountName) {
        return { ok: false, message: "Existing attached repositories cannot be renamed after the task has run." };
      }
      if (next.accessMode !== current.accessMode) {
        return { ok: false, message: "Attached repository access mode cannot be changed." };
      }
      if ((next.purpose ?? null) !== (current.purpose ?? null)) {
        return { ok: false, message: "Existing attached repository purposes cannot be changed after the task has run." };
      }
    }

    void currentByRepositoryId;
  }

  if (options.hasTaskRun && options.allowExistingAttachmentUpdates) {
    for (const current of currentAttachments) {
      const next = nextAttachments.find((attachment) => attachment.repositoryId === current.repositoryId);
      if (next && next.mountName !== current.mountName) {
        return { ok: false, message: "Existing attached repositories cannot be renamed after the task has run." };
      }
    }
  }

  return {
    ok: true,
    attachments: nextAttachments.map((attachment) => ({
      repositoryId: attachment.repositoryId,
      mountName: attachment.mountName,
      accessMode: "read-only",
      purpose: attachment.purpose ?? null
    }))
  };
}

export function buildTaskWorkspaceRepositoryMount(
  repository: Repository,
  attachment: TaskAttachedRepository,
  options?: { isRoot?: boolean; rootMountPath?: string }
): TaskWorkspaceRepositoryMount {
  const rootMountPath = options?.rootMountPath ?? TASK_WORKSPACE_ROOT_PATH;
  const mountPath = options?.isRoot ? rootMountPath : path.posix.join(rootMountPath, TASK_WORKSPACE_REPOSITORIES_DIR_NAME, attachment.mountName);

  return {
    repositoryId: repository.id,
    repositoryName: repository.name,
    repositoryUrl: repository.url,
    repositoryDefaultBranch: repository.defaultBranch,
    mountName: options?.isRoot ? TASK_WORKSPACE_ROOT_MOUNT_NAME : attachment.mountName,
    accessMode: options?.isRoot ? "read-write" : attachment.accessMode,
    purpose: attachment.purpose ?? null,
    mountPath,
    isRoot: Boolean(options?.isRoot)
  };
}

export function buildTaskWorkspaceMap(
  rootRepository: Repository,
  attachments: Array<{ attachment: TaskAttachedRepository; repository: Repository }>,
  options?: { rootMountPath?: string }
): ResolvedTaskWorkspaceMap {
  const rootMountPath = options?.rootMountPath ?? TASK_WORKSPACE_ROOT_PATH;
  return {
    root: buildTaskWorkspaceRepositoryMount(rootRepository, {
      repositoryId: rootRepository.id,
      mountName: TASK_WORKSPACE_ROOT_MOUNT_NAME,
      accessMode: "read-only",
      purpose: null
    }, { isRoot: true, rootMountPath }),
    attachedRepositories: attachments.map(({ attachment, repository }) => {
      const mount = buildTaskWorkspaceRepositoryMount(repository, attachment, { rootMountPath });
      return {
        ...mount,
        repositoryName: repository.name,
        repositoryUrl: repository.url,
        repositoryDefaultBranch: repository.defaultBranch
      };
    })
  };
}

export function remapTaskWorkspaceMapRoot(workspaceMap: TaskWorkspaceMap, rootMountPath: string): TaskWorkspaceMap {
  return {
    root: {
      ...workspaceMap.root,
      mountPath: rootMountPath,
      mountName: TASK_WORKSPACE_ROOT_MOUNT_NAME,
      accessMode: "read-write",
      isRoot: true
    },
    attachedRepositories: workspaceMap.attachedRepositories.map((attachment) => ({
      ...attachment,
      mountPath: path.posix.join(rootMountPath, TASK_WORKSPACE_REPOSITORIES_DIR_NAME, attachment.mountName)
    }))
  };
}

function normalizeTaskWorkspaceEnvVarName(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(TASK_WORKSPACE_ENV_VAR_SAFE_PATTERN, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildTaskWorkspaceEnvEntries(workspaceMap: TaskWorkspaceMap): Array<[string, string]> {
  const envEntries: Array<[string, string]> = [
    ["TASK_ROOT", workspaceMap.root.mountPath],
    ["TASK_REPOS_DIR", path.posix.join(workspaceMap.root.mountPath, TASK_WORKSPACE_REPOSITORIES_DIR_NAME)]
  ];

  for (const attachment of workspaceMap.attachedRepositories) {
    const envVarName = normalizeTaskWorkspaceEnvVarName(`TASK_REPO_${attachment.mountName}`);
    if (!envVarName) {
      continue;
    }
    envEntries.push([envVarName, attachment.mountPath]);
  }

  return envEntries;
}
