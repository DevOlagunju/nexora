import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // tests/db/* run the real services against a migrated database (one private copy per file).
    globalSetup: ["tests/setup/global.ts"],
    setupFiles: ["tests/setup/db-env.ts"],
    // The first database test in a file also pays for connecting and password hashing;
    // the 5s default is too tight on a busy machine or CI runner.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      ENCRYPTION_KEY: "a".repeat(64),
      AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
      // The database tests' balances are worked out with a ₦50 withdrawal fee. Pinned here so
      // they do not change with the default or a local .env.
      WALLET_WITHDRAWAL_FEE_NGN: "50",
      // Most tests expect the desk's shared deposit address; tests/db/deposits.test.ts switches the
      // simulated deposit provider on for itself.
      DEPOSIT_PROVIDER: "none",
    },
  },
});
