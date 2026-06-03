"use client";

import type { TaskDraft, TaskDraftDefinition } from "@agentswarm/shared-types";
import type { TaskDefinitionFormValues } from "../../components/task-definition-fields";
import {
  encodeTaskPromptImageFiles,
  taskPromptAttachmentInputsToSelectedFiles,
  type SelectedTaskPromptImageFile
} from "./task-prompt-attachments";

export const buildTaskDraftDefinition = async (
  values: TaskDefinitionFormValues,
  promptImageFiles: SelectedTaskPromptImageFile[]
): Promise<TaskDraftDefinition> => ({
  sourceType: values.sourceType ?? "blank",
  title: values.title,
  repoId: values.repoId,
  prompt: values.prompt,
  notes: values.notes,
  taskType: values.taskType,
  provider: values.provider,
  model: values.model,
  providerProfile: values.providerProfile,
  codexCredentialSource: values.codexCredentialSource,
  baseBranch: values.baseBranch,
  branchStrategy: values.branchStrategy,
  issueNumber: values.issueNumber,
  includeComments: values.includeComments,
  pullRequestNumber: values.pullRequestNumber,
  snippetId: values.snippetId,
  snippetVariables: values.snippetVariables,
  sequenceId: values.sequenceId,
  sequenceVariables: values.sequenceVariables,
  attachments: await encodeTaskPromptImageFiles(promptImageFiles)
});

export const formValuesFromTaskDraft = (draft: TaskDraft): TaskDefinitionFormValues => ({
  ...draft.definition,
  sourceType: draft.definition.sourceType ?? "blank"
});

export const promptImageFilesFromTaskDraft = (draft: TaskDraft): SelectedTaskPromptImageFile[] =>
  taskPromptAttachmentInputsToSelectedFiles(draft.definition.attachments);
