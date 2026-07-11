import assert from "node:assert/strict";
import test from "node:test";
import { HARNESS_EDITOR_OPTIONS, normalizeHarnessMarkdown } from "./harness-editor";

test("normalizeHarnessMarkdown preserves content and normalizes missing values", () => {
  assert.equal(normalizeHarnessMarkdown("# Harness\n\nGuidance"), "# Harness\n\nGuidance");
  assert.equal(normalizeHarnessMarkdown(null), "");
  assert.equal(normalizeHarnessMarkdown(undefined), "");
});

test("Harness Monaco configuration disables interactive editor features", () => {
  assert.equal(HARNESS_EDITOR_OPTIONS.contextmenu, false);
  assert.equal(HARNESS_EDITOR_OPTIONS.quickSuggestions, false);
  assert.equal(HARNESS_EDITOR_OPTIONS.suggestOnTriggerCharacters, false);
  assert.equal(HARNESS_EDITOR_OPTIONS.hover.enabled, false);
  assert.equal(HARNESS_EDITOR_OPTIONS.lineNumbers, "off");
  assert.equal(HARNESS_EDITOR_OPTIONS.minimap.enabled, false);
});
