import { env } from "../config/env.js";
import { createPostgresPool, runPostgresMigrations } from "../lib/postgres.js";

const main = async (): Promise<void> => {
  const pool = createPostgresPool(env.DATABASE_URL);
  try {
    await runPostgresMigrations(pool);
  } finally {
    await pool.end();
  }
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
