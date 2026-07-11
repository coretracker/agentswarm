import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateDockerSocketAccessPolicy,
  resolveDockerSocketEnvEntries,
  resolveDockerSocketMountArgs,
  resolveDockerSocketRunArgs
} from "./docker-socket-access.js";

describe("evaluateDockerSocketAccessPolicy", () => {
  it("stays disabled by default when the feature flag is off", () => {
    const policy = evaluateDockerSocketAccessPolicy({
      enabled: false,
      appEnvironment: "local",
      hostPath: "/var/run/docker.sock",
      containerPath: "/var/run/docker.sock"
    });

    assert.equal(policy.enabled, false);
    assert.equal(policy.deniedReason, "feature_disabled");
  });

  it("allows access when enabled and no environment allow-list is configured", () => {
    const policy = evaluateDockerSocketAccessPolicy({
      enabled: true,
      appEnvironment: "staging",
      hostPath: "/var/run/docker.sock",
      containerPath: "/var/run/docker.sock"
    });

    assert.equal(policy.enabled, true);
    assert.equal(policy.deniedReason, null);
  });

  it("does not require an approved environment allow-list", () => {
    const policy = evaluateDockerSocketAccessPolicy({
      enabled: true,
      appEnvironment: "development",
      hostPath: "/var/run/docker.sock",
      containerPath: "/var/run/docker.sock"
    });

    assert.equal(policy.enabled, true);
    assert.equal(policy.deniedReason, null);
  });

  it("blocks access when socket paths are invalid", () => {
    const policy = evaluateDockerSocketAccessPolicy({
      enabled: true,
      appEnvironment: "local",
      hostPath: " ",
      containerPath: "/var/run/docker.sock"
    });

    assert.equal(policy.enabled, false);
    assert.equal(policy.deniedReason, "invalid_socket_path");
  });
});

describe("docker socket mount/env helpers", () => {
  it("returns mount and DOCKER_HOST when policy is enabled", () => {
    const policy = evaluateDockerSocketAccessPolicy({
      enabled: true,
      appEnvironment: "local",
      hostPath: "/var/run/docker.sock",
      containerPath: "/socket/docker.sock"
    });

    assert.deepEqual(resolveDockerSocketMountArgs(policy), ["-v", "/var/run/docker.sock:/socket/docker.sock:rw"]);
    assert.deepEqual(resolveDockerSocketEnvEntries(policy), [["DOCKER_HOST", "unix:///socket/docker.sock"]]);
    assert.deepEqual(resolveDockerSocketRunArgs(policy), [
      "-v",
      "/var/run/docker.sock:/socket/docker.sock:rw",
      "-e",
      "DOCKER_HOST=unix:///socket/docker.sock"
    ]);
  });

  it("returns no mount/env entries when policy is disabled", () => {
    const policy = evaluateDockerSocketAccessPolicy({
      enabled: false,
      appEnvironment: "local",
      hostPath: "/var/run/docker.sock",
      containerPath: "/var/run/docker.sock"
    });

    assert.deepEqual(resolveDockerSocketMountArgs(policy), []);
    assert.deepEqual(resolveDockerSocketEnvEntries(policy), []);
    assert.deepEqual(resolveDockerSocketRunArgs(policy), []);
  });
});
