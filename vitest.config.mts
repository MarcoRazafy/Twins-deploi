import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Three projects:
 * - unit: pure functions, no database, no Docker (fast, run on every change);
 * - api: the server API against the throw-away database mini_railway_test;
 * - pipeline: real deployments through Docker (slow, needs the Docker daemon).
 * `npm test` runs them all; `npm run test:<name>` runs one.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    // The api and pipeline projects share the test database: one file at a time, everywhere.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "api",
          include: ["tests/api/**/*.test.ts"],
          setupFiles: ["tests/helpers/setup-env.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "pipeline",
          include: ["tests/pipeline/**/*.test.ts"],
          setupFiles: ["tests/helpers/setup-env.ts"],
          fileParallelism: false,
          testTimeout: 300_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
