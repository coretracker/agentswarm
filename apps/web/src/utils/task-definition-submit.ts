"use client";

import type { Task, TaskDefinitionInput } from "@agentswarm/shared-types";
import { api } from "../api/client";

export const startMessageForDefinition = (definition: TaskDefinitionInput): string => {
  if (definition.sourceType === "pull_request") {
    return "Pull request task created and started";
  }

  if (definition.sourceType === "issue") {
    return definition.taskType === "ask" ? "Ask task created and started" : "Build task created and started";
  }

  return definition.taskType === "ask" ? "Ask task created and started" : "Build task created and started";
};

export const createTaskFromDefinition = (definition: TaskDefinitionInput, options: { draft?: boolean } = {}): Promise<Task> => {
  if (definition.sourceType === "issue") {
    return api.createTaskFromIssue({
      repoId: definition.repoId,
      draft: options.draft,
      issueNumber: definition.issueNumber,
      includeComments: definition.includeComments,
      notes: definition.notes,
      deadline: definition.deadline,
      taskType: definition.taskType,
      title: definition.title,
      provider: definition.provider,
      providerProfile: definition.providerProfile,
      modelOverride: definition.model || undefined,
      codexCredentialSource: definition.codexCredentialSource,
      baseBranch: definition.baseBranch,
      branchStrategy: definition.branchStrategy
    });
  }

  if (definition.sourceType === "pull_request") {
    return api.createTaskFromPullRequest({
      repoId: definition.repoId,
      draft: options.draft,
      pullRequestNumber: definition.pullRequestNumber,
      notes: definition.notes,
      deadline: definition.deadline,
      title: definition.title,
      provider: definition.provider,
      providerProfile: definition.providerProfile,
      modelOverride: definition.model || undefined,
      codexCredentialSource: definition.codexCredentialSource
    });
  }

  return api.createTask({
    title: definition.title,
    draft: options.draft,
    repoId: definition.repoId,
    prompt: definition.prompt,
    notes: definition.notes,
    deadline: definition.deadline,
    attachments: definition.sourceType === "blank" || definition.sourceType === "snippet" ? definition.attachments : undefined,
    taskType: definition.taskType,
    provider: definition.provider,
    providerProfile: definition.providerProfile,
    modelOverride: definition.model || undefined,
    codexCredentialSource: definition.codexCredentialSource,
    baseBranch: definition.baseBranch,
    branchStrategy: definition.branchStrategy,
    ...(definition.sourceType === "snippet"
        ? {
            task_source: "snippet" as const,
            snippet_id: definition.snippetId
          }
        : { task_source: "blank" as const })
  });
};
