import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { CreateTaskInput, Task } from "@agentswarm/shared-types";
import { api } from "../api/client";
import { createTaskFromDefinition } from "./task-definition-submit";

const originalCreateTask = api.createTask;

afterEach(() => {
  api.createTask = originalCreateTask;
});

describe("createTaskFromDefinition", () => {
  it("passes attached repositories to task creation", async () => {
    let submittedInput: CreateTaskInput | null = null;

    api.createTask = async (input: CreateTaskInput): Promise<Task> => {
      submittedInput = input;
      return { id: "task-1" } as Task;
    };

    await createTaskFromDefinition({
      title: "Example",
      repoId: "repo-1",
      prompt: "Do work",
      deadline: null,
      taskType: "build",
      provider: "codex",
      providerProfile: "high",
      model: "gpt-5.4",
      codexCredentialSource: "auto",
      baseBranch: "",
      branchStrategy: "feature_branch",
      attachedRepositories: [
        {
          repositoryId: "repo-2",
          mountName: "shared-utils",
          accessMode: "read-only",
          purpose: "Shared code"
        }
      ]
    });

    assert.deepEqual(submittedInput?.attachedRepositories, [
      {
        repositoryId: "repo-2",
        mountName: "shared-utils",
        accessMode: "read-only",
        purpose: "Shared code"
      }
    ]);
  });
});
