import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeHostCommands, normalizeHostexecCapabilities, normalizeHostexecSettings } from "./hostexec-config.js";

describe("hostexec config normalization", () => {
  it("normalizes hostexec settings without storing token values", () => {
    assert.deepEqual(
      normalizeHostexecSettings({
        enabled: true,
        url: " http://host.docker.internal:38128/ ",
        bearerTokenEnvVar: " HOSTEXEC_TOKEN "
      }),
      {
        enabled: true,
        url: "http://host.docker.internal:38128",
        bearerTokenEnvVar: "HOSTEXEC_TOKEN"
      }
    );
  });

  it("keeps hostexec disabled when URL is missing", () => {
    assert.deepEqual(normalizeHostexecSettings({ enabled: true, url: " " }), {
      enabled: false,
      url: null,
      bearerTokenEnvVar: null
    });
  });

  it("keeps only simple unique host command names", () => {
    assert.deepEqual(
      normalizeHostCommands(["xcodebuild", "XCODEBUILD", "./gradlew", "gradlew", "tool.name", "bad/name", "-bad"]),
      ["xcodebuild", "gradlew", "tool.name"]
    );
  });

  it("normalizes daemon capabilities with allow-all mode", () => {
    assert.deepEqual(normalizeHostexecCapabilities({ allowAll: true, commands: ["xcodebuild", "./bad"] }), {
      allowAll: true,
      commands: ["xcodebuild"]
    });
  });
});
