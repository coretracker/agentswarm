import { Pool, type PoolClient } from "pg";
import { POSTGRES_MIGRATIONS } from "../db/migrations.js";

export type PostgresQueryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export const createPostgresPool = (connectionString: string): Pool =>
  new Pool({
    connectionString,
    max: 10
  });

export const parseJsonColumn = <T>(value: unknown): T => {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
};

export const withPostgresTransaction = async <T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const runPostgresMigrations = async (pool: Pool): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migration of POSTGRES_MIGRATIONS) {
    const existing = await pool.query<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [migration.id]
    );
    if (existing.rowCount) {
      continue;
    }

    await withPostgresTransaction(pool, async (client) => {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
    });
  }
};
