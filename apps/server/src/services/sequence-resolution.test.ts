import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sequence, Snippet } from "@agentswarm/shared-types";
import { resolveSequenceStepPrompts, SequenceValidationError } from "./sequence-resolution.js";

const baseSequence: Sequence = {
  id: "seq-1",
  name: "Sample",
  executionMode: "auto_apply_changes",
  variables: [
    {
      name: "ticket",
      type: "text",
      title: "Ticket",
      description: "",
      defaultValue: ""
    }
  ],
  steps: [
    {
      id: "step_1",
      type: "inline",
      prompt: "Implement ticket {{ticket}}"
    }
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

describe("resolveSequenceStepPrompts", () => {
  it("renders inline variables", async () => {
    const prompts = await resolveSequenceStepPrompts({
      sequence: baseSequence,
      snippetStore: {
        getSnippet: async () => null
      } as never,
      variables: { ticket: "AS-1234" }
    });
    assert.deepEqual(prompts, ["Implement ticket AS-1234"]);
  });

  it("rejects missing required variables", async () => {
    await assert.rejects(
      () =>
        resolveSequenceStepPrompts({
          sequence: baseSequence,
          snippetStore: {
            getSnippet: async () => null
          } as never,
          variables: {}
        }),
      (error: unknown) => error instanceof SequenceValidationError && error.message.includes("Missing required variable")
    );
  });

  it("rejects deleted snippet references", async () => {
    const sequence: Sequence = {
      ...baseSequence,
      steps: [{ id: "step_1", type: "snippet", prompt: "", snippetId: "deleted-snippet" }]
    };
    await assert.rejects(
      () =>
        resolveSequenceStepPrompts({
          sequence,
          snippetStore: {
            getSnippet: async () => null
          } as never,
          variables: { ticket: "AS-1234" }
        }),
      (error: unknown) => error instanceof SequenceValidationError && error.message.includes("deleted snippet")
    );
  });

  it("rejects invalid placeholders", async () => {
    const snippet: Snippet = {
      id: "snippet-1",
      name: "Bad",
      content: "Unknown variable {{missing_name}}",
      variables: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    const sequence: Sequence = {
      ...baseSequence,
      steps: [{ id: "step_1", type: "snippet", prompt: "", snippetId: snippet.id }]
    };

    await assert.rejects(
      () =>
        resolveSequenceStepPrompts({
          sequence,
          snippetStore: {
            getSnippet: async () => snippet
          } as never,
          variables: { ticket: "AS-1234" }
        }),
      (error: unknown) => error instanceof SequenceValidationError && error.message.includes("invalid variable placeholder")
    );
  });
});
