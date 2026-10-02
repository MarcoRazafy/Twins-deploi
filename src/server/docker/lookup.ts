import type { Service as ServiceRow } from "@/generated/prisma/client";

import { db } from "../db";
import { publicContainerId } from "../mappers/container";

const PUBLIC_ID = /^[0-9a-f]{12}$/;

/**
 * The service behind a public container id (see publicContainerId), or null.
 * Only a value found here may be handed to docker: the id itself comes from the client.
 */
export async function findContainerService(publicId: unknown): Promise<ServiceRow | null> {
  if (typeof publicId !== "string" || !PUBLIC_ID.test(publicId)) return null;
  const candidates = await db().service.findMany({ where: { containerName: { not: null } } });
  return candidates.find((service) => publicContainerId(service) === publicId) ?? null;
}
