import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import { TEMPLATE_DB, urlForDatabase, withAdmin, WORKER_DB_PREFIX } from "./pg";

/**
 * Runs before each test file is imported. Files under tests/db get a private clone of the
 * migrated template and DATABASE_URL pointed at it, so `@/lib/db` connects to that clone.
 * Every other test file is pure and gets no database at all.
 */
const testPath = expect.getState().testPath ?? "";

if (/[\\/]tests[\\/]db[\\/]/.test(testPath)) {
  const name = `${WORKER_DB_PREFIX}${process.env.VITEST_POOL_ID ?? "0"}_${randomBytes(4).toString("hex")}`;
  await withAdmin(async (admin) => {
    // Two files cloning at the same instant can briefly collide on the template: retry.
    for (let attempt = 1; ; attempt++) {
      try {
        await admin.query(`create database "${name}" template "${TEMPLATE_DB}"`);
        return;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
  });
  process.env.DATABASE_URL = urlForDatabase(name);
  // A reused worker must not hand the next file the previous file's connection.
  delete (globalThis as { prisma?: unknown }).prisma;
} else {
  // Pure tests must never reach the development database by accident.
  delete process.env.DATABASE_URL;
}
