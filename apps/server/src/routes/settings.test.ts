import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import type { UpdateSettingsInput } from "@verft/shared-types";
import { registerSettingsRoutes } from "./settings.js";

test("PATCH /settings preserves global harness fields", async () => {
  const app = Fastify();
  let updateInput: UpdateSettingsInput | undefined;

  registerSettingsRoutes(app, {
    auth: {
      requireAllScopes: () => async () => undefined
    } as never,
    scheduler: {
      onSettingsChanged: async () => undefined
    } as never,
    settingsStore: {
      updateSettings: async (input: UpdateSettingsInput) => {
        updateInput = input;
        return input;
      }
    } as never
  });

  const harness = {
    harnessWhatExists: "Shared platform context.",
    harnessAllowedActions: "Edit files and run tests.",
    harnessNotAllowedActions: "Do not expose secrets.",
    harnessHowToWork: "Work incrementally.",
    harnessDefinitionOfDone: "CI passes.",
    harnessEvidenceExpectations: "Report test results."
  };
  const response = await app.inject({
    method: "PATCH",
    url: "/settings",
    payload: harness
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(updateInput, harness);
  assert.deepEqual(JSON.parse(response.body), harness);

  await app.close();
});

test("PATCH /settings rejects global harness fields over 8000 characters", async () => {
  const app = Fastify();
  let updateCalled = false;

  registerSettingsRoutes(app, {
    auth: {
      requireAllScopes: () => async () => undefined
    } as never,
    scheduler: {
      onSettingsChanged: async () => undefined
    } as never,
    settingsStore: {
      updateSettings: async () => {
        updateCalled = true;
        return {};
      }
    } as never
  });

  const response = await app.inject({
    method: "PATCH",
    url: "/settings",
    payload: {
      harnessWhatExists: "x".repeat(8001)
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(updateCalled, false);

  await app.close();
});
