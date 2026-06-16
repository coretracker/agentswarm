import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTaskDefinitionInput, type TaskDefinitionFormValues } from "./task-definition-fields";

describe("buildTaskDefinitionInput", () => {
  it("normalizes attached repository inputs and omits invalid entries", () => {
    const values: TaskDefinitionFormValues = {
      title: "Example",
      repoId: "repo-1",
      prompt: "Do work",
      taskType: "build",
      provider: "codex",
      model: "gpt-5.4",
      providerProfile: "high",
      branchStrategy: "feature_branch",
      attachedRepositories: [
        {
          repositoryId: "repo-2",
          mountName: " shared-utils ",
          accessMode: "read-only",
          purpose: "Shared code"
        },
        {
          repositoryId: "",
          mountName: "invalid",
          accessMode: "read-only"
        }
      ]
    };

    const input = buildTaskDefinitionInput(values);

    assert.deepEqual(input.attachedRepositories, [
      {
        repositoryId: "repo-2",
        mountName: "shared-utils",
        accessMode: "read-only",
        purpose: "Shared code"
      }
    ]);
  });
});
