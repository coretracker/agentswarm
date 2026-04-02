import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { insertSnippetContent } from "./snippets";

describe("insertSnippetContent", () => {
  it("returns the snippet when the current value is empty", () => {
    assert.equal(insertSnippetContent("", "  Follow the existing style guide.  "), "Follow the existing style guide.");
  });

  it("appends the snippet with a blank line separator", () => {
    assert.equal(
      insertSnippetContent("Implement the API endpoint.", "Add request validation."),
      "Implement the API endpoint.\n\nAdd request validation."
    );
  });

  it("keeps the current value when the snippet is blank", () => {
    assert.equal(insertSnippetContent("Existing prompt", "   "), "Existing prompt");
  });
});
