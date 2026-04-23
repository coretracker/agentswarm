"use client";

import type { Task, TaskDefinitionInput, TaskStartMode } from "@agentswarm/shared-types";
import { api } from "../api/client";

export const startMessageForDefinition = (definition: TaskDefinitionInput): string => {
  if (definition.sourceType === "pull_request") {
    return "Pull request task created and started";
  }

  const mode: TaskStartMode = definition.startMode ?? "run_now";
  if (mode === "prepare_workspace") {
    return "Task created; preparing workspace in the background";
  }

  if (mode === "idle") {
    return "Task created; start a run from the task when you are ready";
  }

  if (definition.sourceType === "issue") {
    return definition.taskType === "ask" ? "Ask task created and started" : "Build task created and started";
  }

  return definition.taskType === "ask" ? "Ask task created and started" : "Build task created and started";
};

export const createTaskFromDefinition = (definition: TaskDefinitionInput): Promise<Task> => {
  if (definition.sourceType === "issue") {
    return api.createTaskFromIssue({
      repoId: definition.repoId,
      issueNumber: definition.issueNumber,
      includeComments: definition.includeComments,
      taskType: definition.taskType,
      title: definition.title,
      provider: definition.provider,
      providerProfile: definition.providerProfile,
      modelOverride: definition.model || undefined,
      baseBranch: definition.baseBranch,
      branchStrategy: definition.branchStrategy,
      startMode: definition.startMode ?? "run_now"
    });
  }

  if (definition.sourceType === "pull_request") {
    return api.createTaskFromPullRequest({
      repoId: definition.repoId,
      pullRequestNumber: definition.pullRequestNumber,
      title: definition.title,
      provider: definition.provider,
      providerProfile: definition.providerProfile,
      modelOverride: definition.model || undefined
    });
  }

  return api.createTask({
    title: definition.title,
    repoId: definition.repoId,
    prompt: definition.prompt,
    attachments: definition.sourceType === "blank" ? definition.attachments : undefined,
    taskType: definition.taskType,
    startMode: definition.startMode ?? "run_now",
    provider: definition.provider,
    providerProfile: definition.providerProfile,
    modelOverride: definition.model || undefined,
    baseBranch: definition.baseBranch,
    branchStrategy: definition.branchStrategy
  });
};
