/** Access to the singleton "platform" settings document. */

import type { Prisma } from "@/generated/prisma/client";
import type { PlatformSettings } from "@/lib/types";

import { db, type DbClient } from "./db";
import { defaultPlatformSettings, toPlatformSettings } from "./mappers/settings";

const SETTINGS_KEY = "platform";

export async function getPlatformSettings(client: DbClient = db()): Promise<PlatformSettings> {
  const row = await client.setting.findUnique({ where: { key: SETTINGS_KEY } });
  return row ? toPlatformSettings(row.value) : defaultPlatformSettings();
}

export async function savePlatformSettings(
  settings: PlatformSettings,
  client: DbClient = db(),
): Promise<void> {
  // PlatformSettings is plain JSON; interfaces just lack the index signature Prisma asks for.
  const value = settings as unknown as Prisma.InputJsonObject;
  await client.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value },
    update: { value },
  });
}
