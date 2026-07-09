import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pool } from "pg";
import { PostgresSlackIdentityStore } from "./slack-identity-store.js";

describe("PostgresSlackIdentityStore", () => {
  it("normalizes and stores a Slack workspace/user identity", async () => {
    let params: unknown[] = [];
    const pool = {
      query: async (_sql: string, values: unknown[]) => {
        params = values;
        return { rows: [{ id: "user-1", slack_team_id: values[1], slack_user_id: values[2] }] };
      }
    } as unknown as Pool;

    const identity = await new PostgresSlackIdentityStore(pool).setForUser("user-1", " t12345678 ", " u12345678 ");

    assert.deepEqual(identity, {
      userId: "user-1",
      slackTeamId: "T12345678",
      slackUserId: "U12345678"
    });
    assert.deepEqual(params.slice(0, 3), ["user-1", "T12345678", "U12345678"]);
  });

  it("requires workspace and user IDs to be changed together", async () => {
    const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    await assert.rejects(
      () => new PostgresSlackIdentityStore(pool).setForUser("user-1", "T12345678", null),
      /must be set or cleared together/
    );
  });

  it("rejects malformed Slack IDs before persistence", async () => {
    const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    await assert.rejects(
      () => new PostgresSlackIdentityStore(pool).setForUser("user-1", "workspace", "person"),
      /Invalid Slack workspace ID or user ID/
    );
  });
});
