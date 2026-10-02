/**
 * Database access.
 *
 * - `db()` : the Prisma client (one pool per process, kept across dev hot reloads).
 * - `listen()` : a dedicated pg connection for LISTEN, outside the pool, that
 *   reconnects by itself.
 *
 * Convention: helpers that write take a `DbClient` so they work with the root
 * client as well as inside `db().$transaction(async (tx) => …)`.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";

import { PrismaClient, type Prisma } from "@/generated/prisma/client";

import { env } from "./env";

/** The root client or a transaction client. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

const globalStore = globalThis as typeof globalThis & {
  __miniRailwayPrisma?: PrismaClient;
};

export function db(): PrismaClient {
  if (!globalStore.__miniRailwayPrisma) {
    globalStore.__miniRailwayPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: env.databaseUrl }),
    });
  }
  return globalStore.__miniRailwayPrisma;
}

export interface ListenHandle {
  /** Resolves once the connection is listening (again). */
  ready(): Promise<void>;
  close(): Promise<void>;
}

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;

/**
 * Opens a dedicated connection and LISTENs on `channel`. The connection is
 * re-established with an exponential backoff when it drops; notifications sent
 * while it is down are lost (callers treat events as hints, not as a log).
 */
export function listen(channel: string, onPayload: (payload: string) => void): ListenHandle {
  // LISTEN cannot be parameterised: only accept a plain identifier.
  if (!/^[a-z_][a-z0-9_]*$/.test(channel)) {
    throw new Error(`Invalid LISTEN channel: ${channel}`);
  }

  let closed = false;
  let client: Client | null = null;
  let backoff = MIN_BACKOFF_MS;
  let timer: NodeJS.Timeout | null = null;
  let readyResolvers: Array<() => void> = [];
  let isReady = false;

  const scheduleReconnect = (): void => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, backoff);
    timer.unref();
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    const next = new Client({ connectionString: env.databaseUrl });
    let dropped = false;
    const onDrop = (): void => {
      if (dropped) return;
      dropped = true;
      isReady = false;
      if (client === next) client = null;
      next.removeAllListeners();
      // A late error on a dead connection must not crash the process.
      next.on("error", () => {});
      void next.end().catch(() => {});
      scheduleReconnect();
    };
    next.on("error", onDrop);
    next.on("end", onDrop);
    next.on("notification", (message) => {
      if (message.channel === channel && typeof message.payload === "string") {
        onPayload(message.payload);
      }
    });
    try {
      await next.connect();
      await next.query(`LISTEN ${channel}`);
    } catch (error) {
      console.error(
        `[db] LISTEN ${channel} failed, retrying:`,
        error instanceof Error ? error.message : "unknown error",
      );
      onDrop();
      return;
    }
    if (closed || dropped) {
      if (!dropped) void next.end().catch(() => {});
      return;
    }
    client = next;
    backoff = MIN_BACKOFF_MS;
    isReady = true;
    const resolvers = readyResolvers;
    readyResolvers = [];
    for (const resolve of resolvers) resolve();
  };

  void connect();

  return {
    ready: () =>
      isReady ? Promise.resolve() : new Promise<void>((resolve) => readyResolvers.push(resolve)),
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      const current = client;
      client = null;
      if (current) {
        current.removeAllListeners();
        current.on("error", () => {});
        await current.end().catch(() => {});
      }
    },
  };
}
