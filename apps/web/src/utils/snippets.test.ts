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
        { name: "name", type: "text", title: "", description: "", defaultValue: "" },
        { name: "team", type: "text", title: "", description: "", defaultValue: "" }
      ], { name: "Ada", team: "Core" }),
      "Hello Ada from Core"
    );
  });

  it("keeps placeholders for undefined variables", () => {
    assert.equal(
      applySnippetVariables("{{known}} / {{unknown}}", [{ name: "known", type: "text", title: "", description: "", defaultValue: "" }], { known: "ok" }),
      "ok / {{unknown}}"
    );
  });

  it("uses default values when no explicit value is provided", () => {
    assert.equal(
      applySnippetVariables("Hello {{name}}", [{ name: "name", type: "text", title: "", description: "", defaultValue: "there" }], {}),
      "Hello there"
    );
  });

  it("forces text variables to single-line values", () => {
    assert.equal(
      applySnippetVariables("{{name}}", [{ name: "name", type: "text", title: "", description: "", defaultValue: "Line1\nLine2" }], {}),
      "Line1"
    );
    assert.equal(
      applySnippetVariables("{{name}}", [{ name: "name", type: "text", title: "", description: "", defaultValue: "" }], { name: "A\nB" }),
      "A"
    );
  });

  it("keeps multiline values for multiline variables", () => {
    assert.equal(
      applySnippetVariables("{{details}}", [{ name: "details", type: "multiline", title: "", description: "", defaultValue: "A\nB" }], {}),
      "A\nB"
    );
  });
});
