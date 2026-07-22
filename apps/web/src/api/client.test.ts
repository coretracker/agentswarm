import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatApiErrorMessage } from "./client";

describe("formatApiErrorMessage", () => {
  it("does not expose HTML error pages", () => {
    const message = formatApiErrorMessage(502, "Bad Gateway", "<!DOCTYPE html><html><title>Bad gateway</title></html>");

    assert.equal(message, "Bad Gateway (502)");
  });

  it("uses JSON API messages", () => {
    const message = formatApiErrorMessage(409, "Conflict", JSON.stringify({ message: "Task is already running" }));

    assert.equal(message, "Task is already running");
  });
});
