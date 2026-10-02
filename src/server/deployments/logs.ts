/**
 * Build and deploy logs of a deployment (table `deployment_logs`).
 *
 * `seq` is 1-based and consecutive per deployment; `deployments.logSeq` holds
 * the seq of the last line (0 = no line yet). Appends take the deployment row
 * lock through the `logSeq` increment, so concurrent appenders get disjoint
 * ranges and lines become visible in seq order: a reader that saw line N saw
 * every line before N.
 */

import type { DeploymentLog } from "@/generated/prisma/client";
import type { LogLevel, LogLine, LogStream } from "@/lib/types";

import { db } from "../db";

/** Prisma "record to update not found" (P2025). */
function isRecordNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

export interface LogInput {
  level: LogLevel;
  stream: LogStream;
  message: string;
  /** Defaults to now. */
  ts?: Date;
}

/** A log line with its sequence number (the SSE route needs it as a cursor). */
export interface LogEntry {
  seq: number;
  line: LogLine;
}

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error", "success"];
const STREAMS: readonly LogStream[] = ["build", "deploy", "runtime"];
const MAX_MESSAGE_LENGTH = 8000;
/** Most recent lines returned by `readLogTail` unless asked otherwise. */
export const DEFAULT_TAIL = 20_000;

/**
 * Appends lines, oldest first. Resolves with the seq of the last line (0 when
 * nothing was appended). A deployment that no longer exists (deleted while it
 * was running) is ignored. Messages must not contain secrets.
 */
export async function appendLogs(deploymentId: string, lines: readonly LogInput[]): Promise<number> {
  if (lines.length === 0) return 0;
  const count = lines.length;
  const fallbackTs = new Date();
  try {
    return await db().$transaction(async (tx) => {
      const { logSeq } = await tx.deployment.update({
        where: { id: deploymentId },
        data: { logSeq: { increment: count } },
        select: { logSeq: true },
      });
      const first = logSeq - count + 1;
      await tx.deploymentLog.createMany({
        data: lines.map((line, index) => ({
          deploymentId,
          seq: first + index,
          ts: line.ts ?? fallbackTs,
          level: line.level,
          stream: line.stream,
          message:
            line.message.length > MAX_MESSAGE_LENGTH
              ? `${line.message.slice(0, MAX_MESSAGE_LENGTH)}…`
              : line.message,
        })),
      });
      return logSeq;
    });
  } catch (error) {
    if (isRecordNotFound(error)) return 0;
    throw error;
  }
}

function toEntry(row: DeploymentLog): LogEntry {
  return {
    seq: row.seq,
    line: {
      id: `${row.deploymentId}:${row.seq}`,
      ts: row.ts.toISOString(),
      level: LEVELS.find((level) => level === row.level) ?? "info",
      stream: STREAMS.find((stream) => stream === row.stream) ?? "build",
      message: row.message,
    },
  };
}

/** Lines after `afterSeq` (all of them by default), oldest first, at most `limit`. */
export async function readLogEntries(
  deploymentId: string,
  afterSeq = 0,
  limit?: number,
): Promise<LogEntry[]> {
  const rows = await db().deploymentLog.findMany({
    where: { deploymentId, seq: { gt: afterSeq } },
    orderBy: { seq: "asc" },
    take: limit,
  });
  return rows.map(toEntry);
}

export async function readLogs(
  deploymentId: string,
  afterSeq = 0,
  limit?: number,
): Promise<LogLine[]> {
  return (await readLogEntries(deploymentId, afterSeq, limit)).map((entry) => entry.line);
}

/** The last `count` lines, oldest first (a very long build keeps its ending). */
export async function readLogTail(deploymentId: string, count = DEFAULT_TAIL): Promise<LogLine[]> {
  const rows = await db().deploymentLog.findMany({
    where: { deploymentId },
    orderBy: { seq: "desc" },
    take: count,
  });
  return rows.reverse().map((row) => toEntry(row).line);
}
