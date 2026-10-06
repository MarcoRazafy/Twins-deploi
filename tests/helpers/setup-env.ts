/**
 * Runs before every api/pipeline test file, BEFORE any server module is
 * imported: points the server at the throw-away test database and at
 * temporary directories. src/server/env.ts never overrides a variable that is
 * already set, so what is fixed here wins over .env.local and
 * /etc/mini-railway/mini-railway.env.
 *
 * TEST_DATABASE_URL: explicit test database. Without it, the DATABASE_URL of
 * .env.local or /etc/mini-railway/mini-railway.env is reused with the database
 * name replaced by `mini_railway_test` (scripts/test/run-all.sh creates it).
 * The name must end with `_test`: the suite truncates every table.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[match[1]] = value;
    }
  } catch {
    // unreadable: ignored
  }
  return out;
}

function deriveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const sources = [
    path.resolve(process.cwd(), ".env.test"),
    "/etc/mini-railway/mini-railway.env",
    path.resolve(process.cwd(), ".env.local"),
  ];
  for (const file of sources) {
    const url = readEnvFile(file).DATABASE_URL;
    if (!url) continue;
    const parsed = new URL(url);
    parsed.pathname = "/mini_railway_test";
    parsed.search = "";
    return parsed.toString();
  }
  throw new Error("TEST_DATABASE_URL is not set and no DATABASE_URL could be found to derive it from.");
}

const databaseUrl = deriveTestDatabaseUrl();
if (!/_test(\?|$)/.test(new URL(databaseUrl).pathname)) {
  throw new Error(`Refusing to run the tests against ${databaseUrl}: the database name must end with _test.`);
}

Object.assign(process.env, { NODE_ENV: "test" });
process.env.DATABASE_URL = databaseUrl;
process.env.MINI_RAILWAY_SECRET_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const dataDir = mkdtempSync(path.join(tmpdir(), "twinsdeploi-test-"));
process.env.MINI_RAILWAY_DATA_DIR = dataDir;
process.on("exit", () => {
  rmSync(dataDir, { recursive: true, force: true });
});
process.env.MINI_RAILWAY_BASE_DOMAIN = "platform.test";
// No privileged helpers in tests: domains are recorded, not published.
// Set to "" rather than deleted: src/server/env.ts loads .env.local and
// /etc/mini-railway/mini-railway.env for every variable that does not exist,
// so a deleted helper path would come back (and the tests would edit the
// production NGINX and /etc/hosts). An empty value exists and reads as unset.
process.env.MINI_RAILWAY_PROXY_HELPER = "";
process.env.MINI_RAILWAY_HOSTS_HELPER = "";
process.env.MISTRAL_API_KEY = "";
