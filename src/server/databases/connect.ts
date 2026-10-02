/**
 * Connections from the platform to the PostgreSQL container of a project
 * database: 127.0.0.1:<hostPort> (the loopback port the container publishes)
 * with the stored credentials.
 */

import { Client } from "pg";

import { decryptSecret } from "../crypto";
import { unavailable } from "../errors";
import type { DatabaseRecord, LiveDatabaseStats } from "../mappers/database";

export const NOT_STARTED = "La base n’est pas démarrée.";
const UNREACHABLE = "La base de données n’est pas joignable pour le moment.";
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const LIVE_CONNECT_TIMEOUT_MS = 2_000;
const READ_ONLY_TIMEOUT_MS = 5_000;
const WRITE_TIMEOUT_MS = 15_000;

export interface ConnectOptions {
  connectTimeoutMs?: number;
  /** Default true: `default_transaction_read_only = on` and a 5 s statement timeout. */
  readOnly?: boolean;
}

/** True when the container runs and publishes a port. */
export function isReachable(database: DatabaseRecord): boolean {
  return database.service.hostPort !== null && database.service.status === "online";
}

/**
 * Opens a connection; the caller must `end()` it (see `withDatabase`).
 * Rejects with unavailable("La base n’est pas démarrée.") when the service has
 * no host port or is not online, and with a generic unavailable when the server
 * does not answer (details can name hosts and roles: they stay in the server).
 */
export async function connectToDatabase(
  database: DatabaseRecord,
  options: ConnectOptions = {},
): Promise<Client> {
  const { hostPort } = database.service;
  if (hostPort === null || database.service.status !== "online") throw unavailable(NOT_STARTED);

  const readOnly = options.readOnly ?? true;
  const client = new Client({
    host: "127.0.0.1",
    port: hostPort,
    user: database.username,
    password: decryptSecret(database.passwordEncrypted),
    database: database.databaseName,
    connectionTimeoutMillis: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    application_name: "mini-railway",
  });
  // An idle connection can still fail later (container restarted): without a listener Node would crash.
  client.on("error", () => {});
  try {
    await client.connect();
    await client.query(
      readOnly
        ? `SET default_transaction_read_only = on; SET statement_timeout = ${READ_ONLY_TIMEOUT_MS}`
        : `SET statement_timeout = ${WRITE_TIMEOUT_MS}`,
    );
  } catch {
    await client.end().catch(() => {});
    throw unavailable(UNREACHABLE);
  }
  return client;
}

/** Runs `work` on a fresh connection and always closes it. */
export async function withDatabase<T>(
  database: DatabaseRecord,
  work: (client: Client) => Promise<T>,
  options: ConnectOptions = {},
): Promise<T> {
  const client = await connectToDatabase(database, options);
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

interface StatsRow {
  size: number;
  connections: number;
}

const OFFLINE: LiveDatabaseStats = { storageUsedMb: 0, connections: 0, extensions: null };

/** Size, open connections and extensions read live; zeros when the server is not reachable. */
export async function readLiveStats(database: DatabaseRecord): Promise<LiveDatabaseStats> {
  if (!isReachable(database)) return OFFLINE;
  try {
    return await withDatabase(
      database,
      async (client) => {
        const stats = await client.query<StatsRow>(
          `SELECT pg_database_size(current_database())::float8 AS size,
                  (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::float8 AS connections`,
        );
        const extensions = await client.query<{ extname: string }>("SELECT extname FROM pg_extension ORDER BY extname");
        const row = stats.rows[0];
        return {
          storageUsedMb: row ? Math.round((row.size / 1_048_576) * 10) / 10 : 0,
          connections: row ? row.connections : 0,
          extensions: extensions.rows.map((item) => item.extname),
        };
      },
      { connectTimeoutMs: LIVE_CONNECT_TIMEOUT_MS },
    );
  } catch {
    return OFFLINE;
  }
}
