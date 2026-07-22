import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatOpenAiErrorMessage } from "./openai-error-message.js";

describe("formatOpenAiErrorMessage", () => {
  it("does not expose upstream HTML error pages", () => {
    const message = formatOpenAiErrorMessage(502, "<!DOCTYPE html><html><title>Bad gateway</title></html>");

    assert.equal(message, "OpenAI request failed (502). Upstream returned an HTML error page.");
  });

  it("uses JSON API error messages", () => {
    const message = formatOpenAiErrorMessage(429, JSON.stringify({ error: { message: "Rate limit reached" } }));

    assert.equal(message, "Rate limit reached");
  });
});
