import assert from "node:assert/strict";
import test from "node:test";
import { renderAskTemplate, type AskTemplate } from "@verft/shared-types";
import { buildTaskDefinitionInput } from "../../components/task-definition-fields";

const template = {
  prompt: "Summarize {{topic}} for {{audience}}.",
  outputFormat: "# {{topic}}\n\n## Summary",
  variables: [
    { key: "topic", label: "Topic", description: "", type: "text" as const, required: true, defaultValue: "" },
    { key: "audience", label: "Audience", description: "", type: "text" as const, required: false, defaultValue: "Engineers" }
  ]
} as Pick<AskTemplate, "prompt" | "outputFormat" | "variables">;

test("renderAskTemplate substitutes supplied values and defaults", () => {
  assert.equal(
    renderAskTemplate(template, { topic: "Release notes" }),
    "Summarize Release notes for Engineers.\n\nRequired answer format:\n# Release notes\n\n## Summary"
  );
});

test("template tasks always work on the selected branch", () => {
  assert.equal(
    buildTaskDefinitionInput({
      title: "Release summary",
      repoId: "repo-1",
      prompt: "Summarize the release.",
      taskType: "ask",
      baseBranch: "main",
      branchStrategy: "feature_branch",
      templateId: "template-1"
    }).branchStrategy,
    "work_on_branch"
  );
});
