import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dropWorkerDatabases, TEMPLATE_DB, urlForDatabase, withAdmin } from "./pg";

/**
 * Builds one migrated Postgres database for the run (the "template"). Each database test
 * file then works on its own clone (see db-env.ts), so tests never see each other's rows.
 * The real migrations are applied, so a migration that does not apply fails the tests.
 *
 * Without Postgres the pure unit tests still run; the database tests fail with a clear message.
 */

const root = path.resolve(__dirname, "../..");
const tmp = path.join(root, ".tmp");
const stamp = path.join(tmp, "vitest-template.stamp");

function migrationsKey() {
  const dir = path.join(root, "prisma", "migrations");
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => `${f}:${readFileSync(path.join(dir, f)).length}`)
    .join("|");
}

export default async function setup() {
  mkdirSync(tmp, { recursive: true });
  try {
    await withAdmin(async (admin) => {
      await dropWorkerDatabases(admin);
      const key = migrationsKey();
      const exists = (await admin.query("select 1 from pg_database where datname = $1", [TEMPLATE_DB])).rowCount;
      if (exists && existsSync(stamp) && readFileSync(stamp, "utf8") === key) return;

      await admin.query(`drop database if exists "${TEMPLATE_DB}" with (force)`);
      await admin.query(`create database "${TEMPLATE_DB}"`);
      execSync("npx prisma migrate deploy", {
        cwd: root,
        stdio: "pipe",
        env: { ...process.env, DATABASE_URL: urlForDatabase(TEMPLATE_DB) },
      });
      writeFileSync(stamp, key);
    });
  } catch (err) {
    console.warn(`\n[tests] ${err instanceof Error ? err.message : err}\n`);
    return;
  }

  return async () => {
    await withAdmin(dropWorkerDatabases).catch(() => {});
  };
}
