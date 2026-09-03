import assert from "node:assert/strict";
import { test } from "node:test";
import { TeamStore } from "./team-store.js";

class FakePool {
  teams: Array<Record<string, unknown>> = [];
  members = new Set<string>();
  async query(sql: string, values: unknown[] = []) {
    if (sql.startsWith("SELECT id FROM teams")) return { rows: this.teams.filter((team) => team.name_key === values[0]).map((team) => ({ id: team.id })) };
    if (sql.startsWith("SELECT * FROM teams WHERE")) return { rows: this.teams.filter((team) => team.id === values[0]) };
    if (sql.startsWith("SELECT * FROM teams ORDER")) return { rows: [...this.teams] };
    if (sql.startsWith("INSERT INTO teams")) { this.teams.push({ id: values[0], name: values[1], name_key: values[2], created_at: values[3], updated_at: values[4] }); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith("UPDATE teams")) { const team = this.teams.find((entry) => entry.id === values[0])!; team.name = values[1]; team.name_key = values[2]; team.updated_at = values[3]; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith("SELECT EXISTS")) return { rows: [{ exists: this.members.has(String(values[0])) }] };
    if (sql.startsWith("DELETE FROM teams")) { const index = this.teams.findIndex((team) => team.id === values[0]); if (index < 0) return { rows: [], rowCount: 0 }; this.teams.splice(index, 1); return { rows: [], rowCount: 1 }; }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

test("teams normalize names, reject duplicates, and block deletion with members", async () => {
  const pool = new FakePool();
  const store = new TeamStore(pool as never);
  const team = await store.createTeam({ name: "  Platform   Team " });
  assert.equal(team.name, "Platform Team");
  await assert.rejects(() => store.createTeam({ name: "platform team" }), /already exists/);
  assert.equal((await store.updateTeam(team.id, { name: "Core" }))?.name, "Core");
  pool.members.add(team.id);
  await assert.rejects(() => store.deleteTeam(team.id), /Remove or reassign/);
  pool.members.delete(team.id);
  assert.equal(await store.deleteTeam(team.id), true);
});
