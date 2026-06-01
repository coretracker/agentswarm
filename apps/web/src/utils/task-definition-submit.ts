"use client";

import type { Task, TaskDefinitionInput, TaskStartMode } from "@agentswarm/shared-types";
import { api } from "../api/client";

interface ScheduledTaskWindowInput {
  scheduledStartAt: string;
  scheduledEndAt: string;
}

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

  if (definition.sourceType === "sequence") {
    return "Sequence task created and started";
  }

  return definition.taskType === "ask" ? "Ask task created and started" : "Build task created and started";
};

export const createTaskFromDefinition = (definition: TaskDefinitionInput, scheduledWindow?: ScheduledTaskWindowInput): Promise<Task> => {
  if (definition.sourceType === "issue") {
    return api.createTaskFromIssue({
      repoId: definition.repoId,
      issueNumber: definition.issueNumber,
      includeComments: definition.includeComments,
      notes: definition.notes,
      taskType: definition.taskType,
      title: definition.title,
      provider: definition.provider,
      providerProfile: definition.providerProfile,
      modelOverride: definition.model || undefined,
      codexCredentialSource: definition.codexCredentialSource,
      baseBranch: definition.baseBranch,
      branchStrategy: definition.branchStrategy,
      startMode: definition.startMode ?? "run_now",
      ...(scheduledWindow ?? {})
    });
  }

  if (definition.sourceType === "pull_request") {
    return api.createTaskFromPullRequest({
      repoId: definition.repoId,
      pullRequestNumber: definition.pullRequestNumber,
      notes: definition.notes,
      title: definition.title,
      provider: definition.provider,
      providerProfile: definition.providerProfile,
      modelOverride: definition.model || undefined,
      codexCredentialSource: definition.codexCredentialSource,
      ...(scheduledWindow ?? {})
    });
  }

  if (definition.sourceType === "sequence") {
    return api.createTask({
      title: definition.title,
      repoId: definition.repoId,
      prompt: "",
      notes: definition.notes,
      attachments: definition.attachments,
      taskType: definition.taskType,
      startMode: "run_now",
      provider: definition.provider,
      providerProfile: definition.providerProfile,
      modelOverride: definition.model || undefined,
      codexCredentialSource: definition.codexCredentialSource,
      baseBranch: definition.baseBranch,
      branchStrategy: definition.branchStrategy,
      task_source: "sequence",
      sequence_id: definition.sequenceId,
      sequence_variables: definition.sequenceVariables,
      start_mode_locked: true,
      ...(scheduledWindow ?? {})
    });
  }

  return api.createTask({
    title: definition.title,
    repoId: definition.repoId,
    prompt: definition.prompt,
    notes: definition.notes,
    attachments: definition.sourceType === "blank" || definition.sourceType === "snippet" ? definition.attachments : undefined,
    taskType: definition.taskType,
    startMode: definition.sourceType === "snippet" ? "run_now" : (definition.startMode ?? "run_now"),
    provider: definition.provider,
    providerProfile: definition.providerProfile,
    modelOverride: definition.model || undefined,
    codexCredentialSource: definition.codexCredentialSource,
    baseBranch: definition.baseBranch,
    branchStrategy: definition.branchStrategy,
    ...(definition.sourceType === "snippet"
      ? {
          task_source: "snippet" as const,
          snippet_id: definition.snippetId,
          start_mode_locked: true
        }
      : { task_source: "blank" as const }),
    ...(scheduledWindow ?? {})
  });
};
