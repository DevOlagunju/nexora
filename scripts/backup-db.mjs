#!/usr/bin/env node
/**
 * Backup SQLite or dump Postgres.
 * Usage: node scripts/backup-db.mjs
 * Output: backups/nexora-YYYYMMDD-HHMMSS.(db|sql)
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const url = process.env.DATABASE_URL || "file:./prisma/dev.db";
const outDir = path.join(__dirname, "..", "backups");
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const isPostgres = url.startsWith("postgres://") || url.startsWith("postgresql://");

if (isPostgres) {
  const out = path.join(outDir, `nexora-${stamp}.sql`);
  execSync(`pg_dump "${url}" -f "${out}"`, { stdio: "inherit" });
  console.log("Wrote", out);
} else {
  const file = url.replace(/^file:/, "");
  const abs = path.isAbsolute(file) ? file : path.join(__dirname, "..", file);
  if (!fs.existsSync(abs)) {
    console.error("SQLite file not found:", abs);
    process.exit(1);
  }
  const out = path.join(outDir, `nexora-${stamp}.db`);
  fs.copyFileSync(abs, out);
  console.log("Wrote", out);
}

console.log("Tip: keep AuditLog rows; do not truncate audit tables in production.");
