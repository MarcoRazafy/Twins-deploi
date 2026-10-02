import type { ISODate } from "@/lib/types";

import { DAY, HOUR, iso, SECOND } from "../text";

/** Every seeded timestamp is expressed relative to the seeding moment. */
export interface SeedClock {
  now: number;
  secondsAgo(seconds: number): ISODate;
  hoursAgo(hours: number): ISODate;
  daysAgo(days: number): ISODate;
  inDays(days: number): ISODate;
}

export function createClock(now: number): SeedClock {
  return {
    now,
    secondsAgo: (seconds) => iso(now - seconds * SECOND),
    hoursAgo: (hours) => iso(now - hours * HOUR),
    daysAgo: (days) => iso(now - days * DAY),
    inDays: (days) => iso(now + days * DAY),
  };
}

/** Stable ids, so deep links keep working after a reset of the demo data. */
export const PRJ = {
  cancham: "prj_cancham",
  boutique: "prj_boutique",
  observatoire: "prj_observatoire",
  portfolio: "prj_portfolio",
} as const;

export const SVC = {
  canchamPostgres: "svc_cancham_postgres",
  canchamApp: "svc_cancham_app",
  boutiqueStorefront: "svc_boutique_storefront",
  boutiqueApi: "svc_boutique_api",
  boutiqueWorker: "svc_boutique_worker",
  boutiquePostgres: "svc_boutique_postgres",
  boutiqueRedis: "svc_boutique_redis",
  observatoireMetabase: "svc_observatoire_metabase",
  observatoireN8n: "svc_observatoire_n8n",
  observatoirePostgres: "svc_observatoire_postgres",
  portfolioSite: "svc_portfolio_site",
} as const;

export const DBID = {
  cancham: "db_cancham",
  boutique: "db_boutique",
  observatoire: "db_observatoire",
} as const;

export const REPO = {
  canchamApp: "MarcoRazafy/cancham-app",
  storefront: "MarcoRazafy/boutique-vanille-storefront",
  api: "MarcoRazafy/boutique-vanille-api",
  portfolio: "MarcoRazafy/portfolio",
} as const;

export const OWNER_NAME = "Marco Razafy";
