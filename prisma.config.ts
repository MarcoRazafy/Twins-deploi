import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

// Prisma does not load .env files by itself. Same lookup order as the app
// (src/server/env.ts): project files first, then the server-wide file written
// by scripts/server/setup.sh. Variables already set are never overridden.
for (const file of [".env.local", ".env", "/etc/mini-railway/mini-railway.env"]) {
  if (!existsSync(file)) continue;
  try {
    process.loadEnvFile(file);
  } catch {
    // Unreadable for this user: the variables must then come from the environment.
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
