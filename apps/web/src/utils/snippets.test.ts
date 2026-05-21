import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySnippetVariables, insertSnippetContent } from "./snippets";

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

describe("applySnippetVariables", () => {
  it("replaces placeholders for defined variables", () => {
    assert.equal(
      applySnippetVariables("Hello {{name}} from {{team}}", [
        { name: "name", type: "text", title: "", description: "" },
        { name: "team", type: "text", title: "", description: "" }
      ], { name: "Ada", team: "Core" }),
      "Hello Ada from Core"
    );
  });

  it("keeps placeholders for undefined variables", () => {
    assert.equal(
      applySnippetVariables("{{known}} / {{unknown}}", [{ name: "known", type: "text", title: "", description: "" }], { known: "ok" }),
      "ok / {{unknown}}"
    );
  });
});
