import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeTaskDraftDefinition } from "./task-draft-store.js";

describe("normalizeTaskDraftDefinition", () => {
  it("normalizes draft deadlines", () => {
    const definition = normalizeTaskDraftDefinition({
      deadline: "2026-06-15T10:30:00+02:00"
    });

    assert.equal(definition.deadline, "2026-06-15T08:30:00.000Z");
  });

  it("clears empty and invalid draft deadlines", () => {
    assert.equal(normalizeTaskDraftDefinition({ deadline: "" }).deadline, null);
    assert.equal(normalizeTaskDraftDefinition({ deadline: "not a date" }).deadline, null);
    assert.equal(normalizeTaskDraftDefinition({ deadline: null }).deadline, null);
  });
});
