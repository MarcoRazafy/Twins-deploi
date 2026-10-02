import type { EnvVariable, Service } from "@/lib/types";

import { connectionVariables } from "../domain/databases";
import { looksSecret } from "../domain/variables";
import { alphanumeric, hexString, seededRng } from "../generators/prng";
import type { DatabaseRecord } from "../schema";
import { iso } from "../text";
import { PRJ, SVC } from "./clock";

/** [key, value, sealed?] — `sealed` defaults to the usual heuristic on the key. */
type Entry = [key: string, value: string, sealed?: boolean];

const TIMEZONE: Entry = ["TZ", "Indian/Antananarivo"];
const SMTP_HOST: Entry = ["SMTP_HOST", "smtp-relay.brevo.com"];
const DATABASE_REFERENCE: Entry = ["DATABASE_URL", "${{Postgres.DATABASE_URL}}"];
const REDIS_URL: Entry = ["REDIS_URL", "redis://redis.railway.internal:6379", false];

/** Looks like a real credential, yet is the same after every reset. */
function secret(name: string, length = 40): string {
  return alphanumeric(seededRng("secret", name), length);
}

const SHARED: Record<string, Entry[]> = {
  [PRJ.cancham]: [TIMEZONE, ["APP_ENV", "production"], ["DEFAULT_LOCALE", "fr"]],
  [PRJ.boutique]: [TIMEZONE, ["APP_ENV", "production"], ["LOG_LEVEL", "info"]],
  [PRJ.observatoire]: [TIMEZONE, ["APP_ENV", "production"]],
  [PRJ.portfolio]: [TIMEZONE, ["PLAUSIBLE_DOMAIN", "marco-razafy.dev"]],
};

const BY_SERVICE: Record<string, Entry[]> = {
  [SVC.canchamApp]: [
    ["NODE_ENV", "production"],
    ["PORT", "3000"],
    DATABASE_REFERENCE,
    ["NEXTAUTH_URL", "https://app.cancham.mg", false],
    ["NEXTAUTH_SECRET", secret("cancham-nextauth", 44)],
    ["NEXT_PUBLIC_APP_URL", "https://app.cancham.mg", false],
    SMTP_HOST,
    ["SMTP_PORT", "587"],
    ["SMTP_USER", "notifications@cancham.mg"],
    ["SMTP_PASSWORD", secret("cancham-smtp", 24)],
    ["MVOLA_CONSUMER_KEY", secret("cancham-mvola-key", 28)],
    ["MVOLA_CONSUMER_SECRET", secret("cancham-mvola-secret", 28)],
    ["STORAGE_PATH", "/app/storage"],
  ],
  [SVC.boutiqueStorefront]: [
    ["NODE_ENV", "production"],
    ["PORT", "3000"],
    ["NEXT_PUBLIC_API_URL", "https://api-production-7c1e.up.mini-railway.app", false],
    ["NEXT_PUBLIC_SITE_URL", "https://boutique-vanille.mg", false],
    ["NEXT_PUBLIC_CURRENCY", "MGA"],
    ["REVALIDATE_SECRET", secret("storefront-revalidate", 32)],
  ],
  [SVC.boutiqueApi]: [
    ["NODE_ENV", "production"],
    ["PORT", "3000"],
    DATABASE_REFERENCE,
    REDIS_URL,
    ["JWT_SECRET", secret("api-jwt", 48)],
    ["CORS_ORIGIN", "https://boutique-vanille.mg"],
    ["MVOLA_CONSUMER_KEY", secret("api-mvola-key", 28)],
    ["MVOLA_CONSUMER_SECRET", secret("api-mvola-secret", 28)],
    SMTP_HOST,
  ],
  [SVC.boutiqueWorker]: [
    DATABASE_REFERENCE,
    REDIS_URL,
    ["QUEUE_CONCURRENCY", "4"],
    SMTP_HOST,
    ["SMTP_PASSWORD", secret("worker-smtp", 24)],
  ],
  [SVC.boutiqueRedis]: [["REDIS_ARGS", "--appendonly yes --maxmemory 256mb"]],
  [SVC.observatoireMetabase]: [
    ["MB_DB_TYPE", "postgres"],
    ["MB_DB_CONNECTION_URI", "${{Postgres.DATABASE_URL}}", true],
    ["MB_SITE_URL", "https://metabase-production-b93d.up.mini-railway.app", false],
    ["MB_SITE_LOCALE", "fr"],
    ["JAVA_TIMEZONE", "Indian/Antananarivo"],
  ],
  [SVC.observatoireN8n]: [
    ["N8N_PORT", "5678"],
    ["N8N_PROTOCOL", "https"],
    ["GENERIC_TIMEZONE", "Indian/Antananarivo"],
    ["DB_TYPE", "postgresdb"],
    ["DB_POSTGRESDB_HOST", "${{Postgres.PGHOST}}"],
    ["DB_POSTGRESDB_PASSWORD", "${{Postgres.PGPASSWORD}}"],
    ["N8N_ENCRYPTION_KEY", hexString(seededRng("secret", "n8n-encryption"), 32)],
  ],
  [SVC.portfolioSite]: [
    ["NODE_ENV", "production"],
    ["PORT", "4321"],
    ["PUBLIC_SITE_URL", "https://marco-razafy.dev", false],
  ],
};

export function seedVariables(services: Service[], databases: DatabaseRecord[]): EnvVariable[] {
  const variables: EnvVariable[] = [];

  const push = (
    projectId: string,
    serviceId: string | null,
    scopeKey: string,
    entries: Entry[],
    createdAt: number,
  ) => {
    entries.forEach(([key, value, sealed], index) => {
      // Listed order = display order: lists are served newest first.
      const at = iso(createdAt + entries.length - index);
      variables.push({
        id: `var_${scopeKey}_${key.toLowerCase()}`,
        projectId,
        serviceId,
        key,
        value,
        isSecret: sealed ?? looksSecret(key),
        createdAt: at,
        updatedAt: at,
      });
    });
  };

  for (const service of services) {
    const scopeKey = service.id.replace(/^svc_/, "");
    const database = databases.find((item) => item.serviceId === service.id);
    const entries: Entry[] = database
      ? connectionVariables(database).map(({ key, value, isSecret }) => [key, value, isSecret])
      : (BY_SERVICE[service.id] ?? []);
    push(service.projectId, service.id, scopeKey, entries, Date.parse(service.createdAt));
  }

  for (const [projectId, entries] of Object.entries(SHARED)) {
    const first = services
      .filter((service) => service.projectId === projectId)
      .reduce((earliest, service) => Math.min(earliest, Date.parse(service.createdAt)), Infinity);
    if (Number.isFinite(first)) {
      push(projectId, null, `${projectId.replace(/^prj_/, "")}_shared`, entries, first);
    }
  }

  return variables;
}
