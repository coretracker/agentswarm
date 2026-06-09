"use client";

import type { Task, TaskDefinitionInput } from "@agentswarm/shared-types";
import { api } from "../api/client";

export const startMessageForDefinition = (definition: TaskDefinitionInput): string => {
  return definition.taskType === "ask" ? "Ask task created and started" : "Build task created and started";
};

export const createTaskFromDefinition = (definition: TaskDefinitionInput, options: { draft?: boolean } = {}): Promise<Task> => {
  return api.createTask({
    title: definition.title,
    draft: options.draft,
    repoId: definition.repoId,
    prompt: definition.prompt,
    notes: definition.notes,
    deadline: definition.deadline,
    attachments: definition.attachments,
    taskType: definition.taskType,
    provider: definition.provider,
    providerProfile: definition.providerProfile,
    modelOverride: definition.model || undefined,
    codexCredentialSource: definition.codexCredentialSource,
    baseBranch: definition.baseBranch,
    branchStrategy: definition.branchStrategy
  });
};
