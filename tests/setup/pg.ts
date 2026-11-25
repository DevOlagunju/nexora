import "dotenv/config";
import { Client } from "pg";

/**
 * Test databases live on the same Postgres server as development but under their own
 * names, so a test run can never read or change real data:
 *   nexora_test_template   migrated once per run
 *   nexora_test_w...       a private clone per test file, dropped at the end
 */

export const TEMPLATE_DB = "nexora_test_template";
export const WORKER_DB_PREFIX = "nexora_test_w";

const serverUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

export function urlForDatabase(name: string) {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Runs statements against the server's maintenance database. */
export async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  if (!/^postgres(ql)?:\/\//.test(serverUrl)) {
    throw new Error("Database tests need Postgres. Set DATABASE_URL (or TEST_DATABASE_URL) and run `docker compose up -d postgres`.");
  }
  const client = new Client({ connectionString: urlForDatabase("postgres"), connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Database tests could not reach Postgres (${err instanceof Error ? err.message : err}). Run \`docker compose up -d postgres\`.`,
    );
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function dropWorkerDatabases(client: Client) {
  const { rows } = await client.query<{ datname: string }>("select datname from pg_database where datname like $1", [
    `${WORKER_DB_PREFIX}%`,
  ]);
  for (const { datname } of rows) await client.query(`drop database if exists "${datname}" with (force)`);
}
