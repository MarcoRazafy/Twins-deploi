/**
 * Switch of the server console, kept apart from the "platform" settings
 * document so that `settings.update` can never flip it.
 */

import type { Prisma } from "@/generated/prisma/client";
import type { ServerConsoleStatus } from "@/lib/types";

import { db, type DbClient } from "../db";

const SETTINGS_KEY = "server-console";

const DISABLED: ServerConsoleStatus = { enabled: false, updatedBy: null, updatedAt: null };

/** Anything that is not exactly an enabled switch reads as disabled. */
export function toServerConsoleStatus(value: unknown): ServerConsoleStatus {
  if (typeof value !== "object" || value === null) return DISABLED;
  const raw = value as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

export async function getServerConsoleStatus(client: DbClient = db()): Promise<ServerConsoleStatus> {
  const row = await client.setting.findUnique({ where: { key: SETTINGS_KEY } });
  return row ? toServerConsoleStatus(row.value) : DISABLED;
}

export async function saveServerConsoleStatus(
  status: ServerConsoleStatus,
  client: DbClient = db(),
): Promise<void> {
  const value = status as unknown as Prisma.InputJsonObject;
  await client.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value },
    update: { value },
  });
}
