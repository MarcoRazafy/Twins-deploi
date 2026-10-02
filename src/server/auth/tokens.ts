/** API tokens: "Authorization: Bearer mr_live_<32 hex>", only the SHA-256 is stored. */

import type { User } from "@/generated/prisma/client";

import { randomHex, sha256Hex } from "../crypto";
import { db } from "../db";

export const API_TOKEN_PREFIX = "mr_live_";
const TOKEN_PATTERN = /^mr_live_[0-9a-f]{32}$/;
const LAST_USED_INTERVAL_MS = 60 * 1000;

export interface GeneratedApiToken {
  /** Shown once to the user, never stored. */
  secret: string;
  /** First characters, safe to display. */
  prefix: string;
  tokenHash: string;
}

export function generateApiToken(): GeneratedApiToken {
  const secret = `${API_TOKEN_PREFIX}${randomHex(16)}`;
  return { secret, prefix: secret.slice(0, 12), tokenHash: sha256Hex(secret) };
}

/** The bearer value of an Authorization header, or null. */
export function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

export async function resolveApiToken(secret: string | null): Promise<User | null> {
  if (!secret || !TOKEN_PATTERN.test(secret)) return null;
  const token = await db().apiToken.findUnique({
    where: { tokenHash: sha256Hex(secret) },
    include: { user: true },
  });
  if (!token) return null;
  const now = Date.now();
  if (token.expiresAt && token.expiresAt.getTime() <= now) return null;
  if (token.user.status !== "active") return null;
  if (!token.lastUsedAt || now - token.lastUsedAt.getTime() > LAST_USED_INTERVAL_MS) {
    await db().apiToken.updateMany({ where: { id: token.id }, data: { lastUsedAt: new Date(now) } });
  }
  return token.user;
}
