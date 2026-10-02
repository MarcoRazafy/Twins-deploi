/** Browser sessions: the cookie holds a random token, the database only its SHA-256. */

import type { User } from "@/generated/prisma/client";

import { randomToken, sha256Hex } from "../crypto";
import { db, type DbClient } from "../db";
import { newId } from "../ids";
import { SESSION_TTL_MS } from "./cookies";

// The expiry slides, but is only rewritten once in a while to keep reads cheap.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface ResolvedSession {
  user: User;
  /** True when the expiry was just extended: the cookie should be re-issued. */
  refreshed: boolean;
}

/** Returns the raw token to put in the cookie. */
export async function createSession(
  userId: string,
  userAgent: string | null,
  client: DbClient = db(),
): Promise<string> {
  const token = randomToken(32);
  await client.session.create({
    data: {
      id: newId("ses"),
      tokenHash: sha256Hex(token),
      userId,
      userAgent: userAgent ? userAgent.slice(0, 300) : null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export async function resolveSession(token: string | null): Promise<ResolvedSession | null> {
  // 32 random bytes in base64url: anything else cannot be one of ours.
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await db().session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || session.user.status !== "active") {
    await db().session.deleteMany({ where: { id: session.id } });
    return null;
  }
  let refreshed = false;
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db().session.updateMany({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) },
    });
    refreshed = true;
  }
  return { user: session.user, refreshed };
}

export async function destroySession(token: string | null): Promise<void> {
  if (!token) return;
  await db().session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
}

/** Signs a user out everywhere (role change, removal). */
export async function destroyUserSessions(userId: string, client: DbClient = db()): Promise<void> {
  await client.session.deleteMany({ where: { userId } });
}
