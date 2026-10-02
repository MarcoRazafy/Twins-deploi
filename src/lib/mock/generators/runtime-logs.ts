/**
 * Runtime (container) logs.
 *
 * Lines are anchored on a wall-clock grid of slots: slot `k` of a container
 * always produces the same 1–2 lines at the same instant. The history served by
 * `getContainerLogs` and the stream pushed by `subscribeContainerLogs` are
 * therefore two views of one sequence (same ids, same timestamps).
 */

import type { LogLevel, LogLine } from "@/lib/types";

import { iso } from "../text";
import { bootLines, fillTimePlaceholders, type BootInfo, type Entry } from "./boot";
import type { Family } from "./family";
import { chance, hashString, noise, pick, randInt, seededRng, type Rng } from "./prng";

export interface RuntimeContext extends BootInfo {
  containerId: string;
  sourceType: "github" | "docker" | "postgres";
  healthcheckPath: string;
}

/** Nominal slot length; slots are emitted 1.5–3 s apart. */
const SLOT_MS = 2250;
const SLOT_JITTER_MS = 750;

function grid(containerId: string, speed: number): { slotMs: number; offset: number; seed: number } {
  const seed = hashString(containerId);
  const slotMs = SLOT_MS / speed;
  return { slotMs, offset: seed % Math.max(1, Math.floor(slotMs)), seed };
}

/** Instant at which the lines of `slot` are printed. */
export function slotEmitTime(containerId: string, slot: number, speed: number): number {
  const { slotMs, offset, seed } = grid(containerId, speed);
  return slot * slotMs + offset + noise(seed, slot) * (SLOT_JITTER_MS / speed);
}

/** Most recent slot already printed at `now`. */
export function lastEmittedSlot(containerId: string, now: number, speed: number): number {
  const { slotMs, offset } = grid(containerId, speed);
  const slot = Math.floor((now - offset) / slotMs);
  return slotEmitTime(containerId, slot, speed) <= now ? slot : slot - 1;
}

const ROUTES: Array<{ match: RegExp; paths: string[] }> = [
  {
    match: /cancham|membre|annuaire/,
    paths: [
      "/",
      "/membres",
      "/membres/184",
      "/evenements",
      "/evenements/gala-annuel-2026",
      "/factures",
      "/api/members?page=2",
      "/api/events/upcoming",
      "/connexion",
      "/tableau-de-bord",
      "/annuaire?secteur=agroalimentaire",
    ],
  },
  {
    match: /storefront|boutique|shop/,
    paths: [
      "/",
      "/produits",
      "/produits/vanille-bourbon-50g",
      "/produits/poivre-sauvage-voatsiperifery",
      "/categories/epices",
      "/panier",
      "/commande",
      "/api/cart",
      "/livraison",
      "/a-propos",
    ],
  },
  {
    match: /api|backend|service/,
    paths: [
      "/v1/products",
      "/v1/products/12",
      "/v1/orders",
      "/v1/orders/BV-2026-00812",
      "/v1/customers/me",
      "/v1/cart",
      "/v1/categories",
      "/v1/payments/mvola/callback",
    ],
  },
  {
    match: /site|portfolio|blog|vitrine/,
    paths: ["/", "/blog", "/blog/auto-hebergement-docker", "/projets", "/contact", "/rss.xml"],
  },
];

const DEFAULT_ROUTES = ["/", "/api/status", "/login", "/assets/app.js", "/favicon.ico"];

const CLIENT_PREFIXES = ["102.16.44", "41.188.12", "154.126.9", "197.149.60", "90.63.221", "24.48.0"];

interface Request {
  method: string;
  path: string;
  status: number;
  ms: number;
  bytes: number;
  ip: string;
  level: LogLevel;
}

function request(ctx: RuntimeContext, slot: number, rng: Rng): Request {
  const ip = `${pick(rng, CLIENT_PREFIXES)}.${randInt(rng, 2, 254)}`;
  if (ctx.healthcheckPath && slot % 5 === 0) {
    return { method: "GET", path: ctx.healthcheckPath, status: 200, ms: randInt(rng, 1, 9), bytes: 15, ip: "10.0.0.1", level: "debug" };
  }
  const routes = ROUTES.find((entry) => entry.match.test(ctx.slug))?.paths ?? DEFAULT_ROUTES;
  const path = pick(rng, routes);
  const writes = /orders|cart|callback|commande/.test(path) && chance(rng, 0.45);
  const roll = rng();
  const status = roll < 0.01 ? 500 : roll < 0.04 ? 404 : roll < 0.06 ? 401 : roll < 0.11 ? 304 : writes ? 201 : 200;
  return {
    method: writes ? "POST" : "GET",
    path,
    status,
    ms: status === 500 ? randInt(rng, 400, 2400) : randInt(rng, 3, 240),
    bytes: status === 304 ? 0 : randInt(rng, 180, 48_000),
    ip,
    level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
  };
}

const NGINX_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function nginxTime(ms: number): string {
  const date = new Date(ms);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getUTCDate())}/${NGINX_MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}:${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} +0000`;
}

function httpLine(ctx: RuntimeContext, slot: number, rng: Rng, ts: number): Entry {
  const r = request(ctx, slot, rng);
  switch (ctx.family) {
    case "next":
      return [r.level, ` ${r.method} ${r.path} ${r.status} in ${r.ms}ms`];
    case "node":
      return [r.level, `[Nest] 1  - LOG [HTTP] ${r.method} ${r.path} ${r.status} ${r.ms}ms`];
    case "python":
      return [r.level, `INFO:     ${r.ip}:${randInt(rng, 32_000, 60_000)} - "${r.method} ${r.path} HTTP/1.1" ${r.status}`];
    case "go":
      return [r.level, `{"level":"${r.level === "info" || r.level === "debug" ? "info" : r.level}","method":"${r.method}","path":"${r.path}","status":${r.status},"duration_ms":${r.ms},"message":"request"}`];
    case "metabase":
      return [r.level, `INFO metabase.server.middleware.log :: ${r.method} ${slot % 3 === 0 ? "/api/health" : pick(rng, ["/api/dashboard/4", "/api/card/18/query", "/api/collection/root/items", "/api/session/properties"])} ${r.status} ${r.ms} ms (${randInt(rng, 0, 6)} DB calls) App DB connections: ${randInt(rng, 1, 4)}/15 Jetty threads: ${randInt(rng, 2, 6)}/50`];
    default:
      return [r.level, `${r.ip} - - [${nginxTime(ts)}] "${r.method} ${r.path} HTTP/1.1" ${r.status} ${r.bytes} "-" "Mozilla/5.0"`];
  }
}

const PG_TABLES = ["members", "orders", "order_items", "products", "invoices", "registrations", "page_views"];

function postgresLines(slot: number, rng: Rng): Entry[] {
  const pid = 100 + ((slot * 7) % 900);
  const host = `10.0.${randInt(rng, 0, 3)}.${randInt(rng, 2, 60)}`;
  const port = randInt(rng, 32_000, 60_000);
  if (slot % 134 === 0) {
    const buffers = randInt(rng, 12, 240);
    return [
      "{pgts} [27] LOG:  checkpoint starting: time",
      `{pgts} [27] LOG:  checkpoint complete: wrote ${buffers} buffers (${(buffers / 163.84).toFixed(1)}%); 0 WAL file(s) added, 0 removed, 0 recycled; write=${(buffers / 10).toFixed(3)} s, sync=0.004 s, total=${(buffers / 10 + 0.02).toFixed(3)} s; sync files=${randInt(rng, 4, 30)}, longest=0.002 s, average=0.001 s; distance=${randInt(rng, 80, 4200)} kB, estimate=${randInt(rng, 900, 5200)} kB`,
    ];
  }
  const roll = rng();
  if (roll < 0.05) {
    return [["warn", `{pgts} [${pid}] LOG:  duration: ${randInt(rng, 250, 1800)}.${randInt(rng, 100, 999)} ms  statement: SELECT * FROM ${pick(rng, PG_TABLES)} ORDER BY created_at DESC LIMIT 200`]];
  }
  if (roll < 0.1) {
    return [`{pgts} [31] LOG:  automatic vacuum of table "railway.public.${pick(rng, PG_TABLES)}": index scans: 0`];
  }
  if (roll < 0.55) {
    return [
      `{pgts} [${pid}] LOG:  connection received: host=${host} port=${port}`,
      `{pgts} [${pid}] LOG:  connection authorized: user=postgres database=railway application_name=${pick(rng, ["prisma", "pgbouncer", "psql", "node-postgres"])}`,
    ];
  }
  return [`{pgts} [${pid}] LOG:  disconnection: session time: 0:00:0${randInt(rng, 0, 9)}.${randInt(rng, 100, 999)} user=postgres database=railway host=${host} port=${port}`];
}

function redisLines(slot: number, rng: Rng): Entry[] {
  const child = 100 + (slot % 800);
  switch (slot % 4) {
    case 0:
      return [`1:M {redists} * ${randInt(rng, 100, 900)} changes in 300 seconds. Saving...`, `1:M {redists} * Background saving started by pid ${child}`];
    case 1:
      return [`${child - 1}:C {redists} * DB saved on disk`, `${child - 1}:C {redists} * Fork CoW for RDB: current 0 MB, peak 0 MB, average 0 MB`];
    case 2:
      return ["1:M {redists} * Background saving terminated with success"];
    default:
      return [`1:M {redists} - Accepted 10.0.${randInt(rng, 0, 3)}.${randInt(rng, 2, 60)}:${randInt(rng, 32_000, 60_000)}`];
  }
}

const WORKFLOWS = ["Synchronisation des ventes", "Rapport hebdomadaire", "Relance des paniers abandonnés", "Export comptable"];
const JOBS = ["order.paid", "email.receipt", "stock.sync", "invoice.pdf", "payment.reconcile"];

function slotEntries(ctx: RuntimeContext, slot: number, rng: Rng, ts: number): Entry[] {
  switch (ctx.family) {
    case "postgres":
      return postgresLines(slot, rng);
    case "redis":
      return redisLines(slot, rng);
    case "n8n": {
      const execution = 48_000 + (slot % 9000);
      return chance(rng, 0.5)
        ? [`Workflow "${pick(rng, WORKFLOWS)}" started (execution ${execution})`]
        : [`Execution ${execution} finished successfully in ${randInt(rng, 180, 4200)}ms`];
    }
    case "worker": {
      const job = `${pick(rng, JOBS)}#${48_000 + (slot % 9000)}`;
      return chance(rng, 0.3)
        ? [`INFO  job ${job} started`, `INFO  job ${job} completed in ${randInt(rng, 40, 900)}ms`]
        : [`INFO  job ${job} completed in ${randInt(rng, 40, 900)}ms`];
    }
    default: {
      const first = httpLine(ctx, slot, rng, ts);
      return chance(rng, 0.3) ? [first, httpLine(ctx, slot + 1, rng, ts)] : [first];
    }
  }
}

function toLogLines(entries: Entry[], idPrefix: string, lastTs: number, gapMs: number): LogLine[] {
  return entries.map((entry, index) => {
    const ts = lastTs - (entries.length - 1 - index) * gapMs;
    const level = typeof entry === "string" ? "info" : entry[0];
    const message = typeof entry === "string" ? entry : entry[1];
    return {
      id: `${idPrefix}:${index}`,
      ts: iso(ts),
      level,
      stream: "runtime",
      message: fillTimePlaceholders(message, ts),
    };
  });
}

export function slotLines(ctx: RuntimeContext, slot: number, speed: number): LogLine[] {
  const ts = slotEmitTime(ctx.containerId, slot, speed);
  const rng = seededRng("runtime", ctx.containerId, slot);
  return toLogLines(slotEntries(ctx, slot, rng, ts), `${ctx.containerId}:${slot}`, ts, 37);
}

function bootLog(ctx: RuntimeContext, startedAt: number): LogLine[] {
  // Runtime logs never replay initdb: only the first deployment prints it.
  const entries = bootLines({ ...ctx, firstBoot: false }, ctx.sourceType);
  return toLogLines(entries, `${ctx.containerId}:boot:${startedAt}`, startedAt + entries.length * 90, 90);
}

function historySlots(ctx: RuntimeContext, from: number, to: number, speed: number): LogLine[] {
  const wanted = 56 + (hashString(ctx.containerId) % 16);
  const last = lastEmittedSlot(ctx.containerId, to, speed);
  const lines: LogLine[] = [];
  for (let slot = last - wanted + 1; slot <= last; slot += 1) {
    if (slotEmitTime(ctx.containerId, slot, speed) < from) continue;
    lines.push(...slotLines(ctx, slot, speed));
  }
  return lines;
}

/** Recent lines of a running container (boot output included when it started recently). */
export function runningHistory(
  ctx: RuntimeContext,
  startedAt: number,
  now: number,
  speed: number,
): LogLine[] {
  const boot = bootLog(ctx, startedAt);
  const bootEnd = Date.parse(boot[boot.length - 1]?.ts ?? iso(startedAt));
  const lines = historySlots(ctx, bootEnd + 1, now, speed);
  const firstSlotTs = lines.length > 0 ? Date.parse(lines[0].ts) : now;
  // The boot output is only part of the window when no older traffic hides it.
  const recentlyStarted = firstSlotTs - bootEnd < (SLOT_MS * 2) / speed;
  return recentlyStarted ? [...boot.filter((line) => Date.parse(line.ts) <= now), ...lines] : lines;
}

function shutdownEntries(family: Family): Entry[] {
  switch (family) {
    case "postgres":
      return [
        "{pgts} [1] LOG:  received fast shutdown request",
        "{pgts} [1] LOG:  aborting any active transactions",
        '{pgts} [1] LOG:  background worker "logical replication launcher" (PID 32) exited with exit code 1',
        "{pgts} [27] LOG:  shutting down",
        "{pgts} [27] LOG:  checkpoint starting: shutdown immediate",
        "{pgts} [1] LOG:  database system is shut down",
      ];
    case "redis":
      return [
        "1:signal-handler Received SIGTERM scheduling shutdown...",
        "1:M {redists} # User requested shutdown...",
        "1:M {redists} * DB saved on disk",
        "1:M {redists} # Redis is now ready to exit, bye bye...",
      ];
    default:
      return [
        ["warn", "SIGTERM received, shutting down gracefully"],
        "Waiting for in-flight requests to complete",
        "Server closed",
        "Process exited with code 0",
      ];
  }
}

/** Last lines of a container that was stopped cleanly. */
export function stoppedHistory(
  ctx: RuntimeContext,
  startedAt: number,
  stoppedAt: number,
  speed: number,
): LogLine[] {
  const shutdown = shutdownEntries(ctx.family);
  return [
    ...historySlots(ctx, startedAt, stoppedAt - 200, speed),
    ...toLogLines(shutdown, `${ctx.containerId}:stop:${stoppedAt}`, stoppedAt, 60),
  ];
}

function crashEntries(ctx: RuntimeContext, restartCount: number): Entry[] {
  const attempts = `restart ${restartCount}/${Math.max(restartCount, 5)}`;
  if (ctx.family === "worker") {
    return [
      "INFO  job order.paid#48213 started",
      ["error", 'ERROR job order.paid#48213 failed: relation "payment_events" does not exist'],
      ["error", "/app/dist/jobs/process-payment.js:87"],
      ["error", "      throw new JobError(`payment event insert failed: ${err.message}`, { cause: err });"],
      ["error", "            ^"],
      ["error", 'JobError: payment event insert failed: relation "payment_events" does not exist'],
      ["error", "    at processPayment (/app/dist/jobs/process-payment.js:87:13)"],
      ["error", "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)"],
      ["error", "    at async Worker.run (/app/dist/queue/worker.js:142:9) {"],
      ["error", "  code: '42P01',"],
      ["error", '  [cause]: error: relation "payment_events" does not exist'],
      ["error", "      at /app/node_modules/pg/lib/client.js:535:17"],
      ["error", "}"],
      ["error", "Node.js v20.17.0"],
      ["error", `Container exited with code 1 (${attempts}, restart policy: on-failure)`],
    ];
  }
  return [
    ["error", "Unhandled error during startup"],
    ["error", `Error: listen EADDRINUSE: address already in use 0.0.0.0:${ctx.port}`],
    ["error", "    at Server.setupListenHandle [as _listen2] (node:net:1908:16)"],
    ["error", "    at listenInCluster (node:net:1965:12)"],
    ["error", `Container exited with code 1 (${attempts})`],
  ];
}

/** Boot output followed by the stack trace that killed the process. */
export function crashedHistory(ctx: RuntimeContext, stoppedAt: number, restartCount: number): LogLine[] {
  const boot = bootLines({ ...ctx, firstBoot: false }, ctx.sourceType);
  const entries = [...boot, ...crashEntries(ctx, restartCount)];
  return toLogLines(entries, `${ctx.containerId}:crash:${stoppedAt}`, stoppedAt, 140);
}
