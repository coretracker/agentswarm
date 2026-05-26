import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SequenceStep, SnippetVariable } from "@agentswarm/shared-types";
import { mergeSnippetVariables } from "./sequence-variables";

describe("mergeSnippetVariables", () => {
  it("keeps existing variable order and appends new snippet variables", () => {
    const current: SnippetVariable[] = [
      { name: "second", type: "text", title: "", description: "", defaultValue: "" },
      { name: "first", type: "text", title: "", description: "", defaultValue: "" }
    ];
    const steps: SequenceStep[] = [{ id: "step_1", type: "snippet", prompt: "", snippetId: "snippet_a" }];
    const snippetDefinitions = new Map<string, SnippetVariable[]>([
      [
        "snippet_a",
        [
          { name: "first", type: "text", title: "From snippet", description: "", defaultValue: "" },
          { name: "third", type: "multiline", title: "", description: "", defaultValue: "" }
        ]
      ]
    ]);

    const merged = mergeSnippetVariables({ current, steps, snippetDefinitions });
    assert.deepEqual(
      merged.next.map((entry) => entry.name),
      ["second", "first", "third"]
    );
    assert.equal(merged.next[1]?.title, "From snippet");
  });
});
