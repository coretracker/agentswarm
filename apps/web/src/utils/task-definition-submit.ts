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

  if (definition.sourceType === "sequence") {
    return "Sequence task created and started";
  }

  return definition.taskType === "ask" ? "Ask task created and started" : "Build task created and started";
};

export const createTaskFromDefinition = (definition: TaskDefinitionInput): Promise<Task> => {
  if (definition.sourceType === "issue") {
    return api.createTaskFromIssue({
      repoId: definition.repoId,
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

  if (definition.sourceType === "sequence") {
    return api.createTask({
      title: definition.title,
      repoId: definition.repoId,
      prompt: "",
      notes: definition.notes,
      deadline: definition.deadline,
      attachments: definition.attachments,
      taskType: definition.taskType,
      provider: definition.provider,
      providerProfile: definition.providerProfile,
      modelOverride: definition.model || undefined,
      codexCredentialSource: definition.codexCredentialSource,
      baseBranch: definition.baseBranch,
      branchStrategy: definition.branchStrategy,
      task_source: "sequence",
      sequence_id: definition.sequenceId,
      sequence_variables: definition.sequenceVariables
    });
  }

  return api.createTask({
    title: definition.title,
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
