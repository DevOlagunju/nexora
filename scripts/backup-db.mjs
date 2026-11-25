#!/usr/bin/env node
/**
 * Backup SQLite or dump Postgres.
 * Usage: npm run db:backup   (BACKUP_KEEP=14 to prune older files)
 * Output: backups/nexora-YYYY-MM-DDTHH-MM-SS.(db|sql)
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });

const url = process.env.DATABASE_URL || "file:./prisma/dev.db";
const outDir = path.resolve(root, process.env.BACKUP_DIR || "backups");
const keep = Number(process.env.BACKUP_KEEP) || 0;
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const isPostgres = url.startsWith("postgres://") || url.startsWith("postgresql://");

let out;
if (isPostgres) {
  out = path.join(outDir, `nexora-${stamp}.sql`);
  // Pass args as an array: no shell, so the URL (with password) is never shell-interpolated.
  const r = spawnSync("pg_dump", ["--no-owner", "--dbname", url, "--file", out], { stdio: "inherit" });
  if (r.error || r.status !== 0) {
    console.error("pg_dump failed. Is the PostgreSQL client installed and on PATH?", r.error?.message ?? "");
    process.exit(1);
  }
} else {
  const file = url.replace(/^file:/, "");
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  if (!fs.existsSync(abs)) {
    console.error("SQLite file not found:", abs);
    process.exit(1);
  }
  out = path.join(outDir, `nexora-${stamp}.db`);
  // Use SQLite's online backup API so a live WAL database is copied consistently.
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(abs, { readonly: true, fileMustExist: true });
  await db.backup(out);
  db.close();
}
console.log("Wrote", out);

if (keep > 0) {
  const files = fs
    .readdirSync(outDir)
    .filter((f) => /^nexora-.*\.(db|sql)$/.test(f))
    .sort()
    .reverse();
  for (const f of files.slice(keep)) {
    fs.rmSync(path.join(outDir, f));
    console.log("Pruned", f);
  }
}

console.log("Tip: keep AuditLog rows; do not truncate audit tables in production.");
