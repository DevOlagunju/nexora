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
    env: {
      ENCRYPTION_KEY: "a".repeat(64),
      AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
    },
  },
});
