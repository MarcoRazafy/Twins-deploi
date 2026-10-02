/**
 * Sample data of the kit showcase. Everything is deterministic (fixed base
 * time, seeded random) so the server render and the client render agree.
 */

import type {
  DeploymentStatus,
  LogLevel,
  LogLine,
  LogStream,
  MetricPoint,
  MetricRange,
  ProjectColor,
  ServiceType,
} from "@/lib/types";

export const SAMPLE_BASE_TIME = Date.parse("2026-10-01T20:19:57.000Z");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Small seeded generator (mulberry32). */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const RANGE_DURATION: Record<MetricRange, number> = {
  "1h": HOUR,
  "6h": 6 * HOUR,
  "24h": DAY,
  "7d": 7 * DAY,
};

interface SampleMetricOptions {
  seed: number;
  range: MetricRange;
  /** Value the series hovers around. */
  base: number;
  /** Size of the swings. */
  amplitude: number;
  min?: number;
  max?: number;
  points?: number;
}

/** A believable metric: a slow wave plus a random walk, ending at the base time. */
export function sampleMetric({
  seed,
  range,
  base,
  amplitude,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  points = 72,
}: SampleMetricOptions): MetricPoint[] {
  const random = createRandom(seed);
  const step = RANGE_DURATION[range] / (points - 1);
  let drift = 0;

  return Array.from({ length: points }, (_, index) => {
    drift = drift * 0.82 + (random() - 0.5) * amplitude * 0.9;
    const wave = Math.sin(index / 7 + seed) * amplitude * 0.45;
    const value = Math.min(max, Math.max(min, base + wave + drift));
    return {
      t: Math.round(SAMPLE_BASE_TIME - (points - 1 - index) * step),
      v: Math.round(value * 10) / 10,
    };
  });
}

export function sampleSparkline(seed: number, points = 16, trend = 0.6): number[] {
  const random = createRandom(seed);
  let value = 20;
  return Array.from({ length: points }, () => {
    value = Math.max(2, value + (random() - 0.5 + trend * 0.25) * 8);
    return Math.round(value);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Logs
// ─────────────────────────────────────────────────────────────────────────────

const LOG_SCRIPT: Array<[LogStream, LogLevel, string]> = [
  ["build", "info", "==> Clonage du dépôt cancham-mg/cancham-connect (main, a1b2c3d)"],
  ["build", "info", "==> Framework détecté : Next.js 16"],
  ["build", "debug", "Builder Nixpacks 1.34 · Node.js 24 · cache de build restauré (218 Mo)"],
  ["build", "info", "$ npm ci"],
  ["build", "info", "added 412 packages, and audited 413 packages in 18s"],
  ["build", "warn", "npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory."],
  ["build", "info", "$ npm run build"],
  ["build", "info", "> cancham-connect@1.8.2 build"],
  ["build", "info", "> next build"],
  ["build", "info", "   Creating an optimized production build ..."],
  ["build", "success", "   Compiled successfully in 9.4s"],
  ["build", "info", "   Linting and checking validity of types ..."],
  ["build", "info", "   Collecting page data ..."],
  ["build", "info", "   Generating static pages (12/12)"],
  ["build", "debug", "Route (app)                              Size     First Load JS"],
  ["build", "debug", "  /                                      5.2 kB          118 kB"],
  ["build", "debug", "  /adherents                             8.7 kB          131 kB"],
  ["build", "debug", "  /evenements/[slug]                     3.1 kB          112 kB"],
  ["build", "success", "==> Image construite : registry.mini-railway.app/cancham-web:a1b2c3d (184 Mo)"],
  ["deploy", "info", "==> Démarrage du conteneur cancham-web-7f9c2 (1 vCPU, 512 Mo)"],
  ["deploy", "info", "   Next.js 16.3.8 · Local: http://0.0.0.0:3000"],
  ["deploy", "error", "Error: connect ECONNREFUSED 10.0.4.12:5432 (tentative 1/3)"],
  ["deploy", "warn", "Base de données injoignable, nouvelle tentative dans 2 s"],
  ["deploy", "info", "Connexion à postgres.railway.internal:5432 établie"],
  ["deploy", "debug", "GET /api/health 200 in 12ms"],
  ["deploy", "success", "==> Healthcheck réussi sur /api/health"],
  ["deploy", "success", "==> Déploiement actif sur cancham-web-production.up.mini-railway.app"],
];

export const SAMPLE_LOG_LINES: LogLine[] = LOG_SCRIPT.map(([stream, level, message], index) => ({
  id: `sample-${index}`,
  ts: new Date(SAMPLE_BASE_TIME - (LOG_SCRIPT.length - index) * 2300).toISOString(),
  level,
  stream,
  message,
}));

const RUNTIME_MESSAGES: Array<[LogLevel, string]> = [
  ["info", "GET /api/adherents?page=2 200 in 38ms"],
  ["info", "GET /evenements/gala-2026 200 in 54ms"],
  ["debug", "cache HIT /api/partenaires (stale-while-revalidate)"],
  ["info", "POST /api/contact 201 in 112ms"],
  ["warn", "Requête lente : SELECT * FROM adhesions WHERE statut = $1 (842 ms)"],
  ["info", "GET /api/health 200 in 9ms"],
  ["error", "Erreur non gérée : TypeError: Cannot read properties of undefined (reading 'email')"],
  ["success", "Tâche planifiée « rappel-cotisations » terminée (128 e-mails)"],
];

/** `count` runtime lines starting at `startAt`, 180 ms apart: for the volume test. */
export function sampleRuntimeLines(count: number, startAt: number, idPrefix: string): LogLine[] {
  return Array.from({ length: count }, (_, index) => {
    const [level, message] = RUNTIME_MESSAGES[index % RUNTIME_MESSAGES.length];
    return {
      id: `${idPrefix}-${index}`,
      ts: new Date(startAt + index * 180).toISOString(),
      level,
      stream: "deploy",
      message: `${message} · req-${(index * 7919) % 100000}`,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Deployments table
// ─────────────────────────────────────────────────────────────────────────────

export interface SampleDeployment {
  id: string;
  service: string;
  type: ServiceType;
  status: DeploymentStatus;
  sha: string;
  message: string;
  author: string;
  /** Milliseconds before "now". */
  ageMs: number;
  durationMs: number | null;
}

export const SAMPLE_DEPLOYMENTS: SampleDeployment[] = [
  {
    id: "dep-01",
    service: "cancham-web",
    type: "github",
    status: "building",
    sha: "9f31c2ab77d0e15c",
    message: "feat: annuaire des adhérents avec recherche",
    author: "Marco Razafy",
    ageMs: 40_000,
    durationMs: null,
  },
  {
    id: "dep-02",
    service: "api-gateway",
    type: "docker",
    status: "active",
    sha: "a1b2c3d4e5f60718",
    message: "nginx:1.27-alpine",
    author: "Hery Rakotomalala",
    ageMs: 18 * MINUTE,
    durationMs: 42_000,
  },
  {
    id: "dep-03",
    service: "cancham-web",
    type: "github",
    status: "removed",
    sha: "4be09d17c3aa52f1",
    message: "fix: correction du formulaire d’adhésion",
    author: "Soa Andrianina",
    ageMs: 3 * HOUR,
    durationMs: 125_000,
  },
  {
    id: "dep-04",
    service: "worker-emails",
    type: "github",
    status: "failed",
    sha: "c07a1e99b2d4f630",
    message: "chore: mise à jour de nodemailer",
    author: "Marco Razafy",
    ageMs: 26 * HOUR,
    durationMs: 67_000,
  },
  {
    id: "dep-05",
    service: "Postgres",
    type: "postgres",
    status: "active",
    sha: "",
    message: "postgres:17",
    author: "Marco Razafy",
    ageMs: 5 * DAY,
    durationMs: 18_000,
  },
  {
    id: "dep-06",
    service: "cancham-web",
    type: "github",
    status: "cancelled",
    sha: "e2d94f08a61b7c35",
    message: "wip: page des événements",
    author: "Hery Rakotomalala",
    ageMs: 9 * DAY,
    durationMs: 8_000,
  },
];

export const SAMPLE_PROJECTS: Array<{ name: string; color: ProjectColor }> = [
  { name: "CanCham Connect", color: "purple" },
  { name: "Alliée Virtuelle", color: "blue" },
  { name: "Boutique Vanille", color: "green" },
  { name: "Tsena Market", color: "amber" },
  { name: "Radio Fitiavana", color: "pink" },
  { name: "Observatoire Climat", color: "cyan" },
];

export const SAMPLE_PEOPLE = [
  "Marco Razafy",
  "Hery Rakotomalala",
  "Soa Andrianina",
  "Élodie Rabe",
];
