import type { Api } from "@/lib/api/contract";
import type { AuthSession } from "@/lib/types";

import {
  clearLoginFailures,
  createSession,
  destroySession,
  loginKey,
  loginLockRemaining,
  recordLoginFailure,
} from "../auth";
import type { Context } from "../context";
import { hashPassword, verifyPassword } from "../crypto";
import { db } from "../db";
import { conflict, forbidden, isUniqueViolation } from "../errors";
import { newId } from "../ids";
import { toUserProfile } from "../mappers/user";
import { asRecord, asString, normalizeEmail, validEmail, validPassword, validPersonName } from "../rules";

// Arbitrary constant: serialises concurrent first-run setups.
const SETUP_LOCK_ID = 727_001;

export function createAuthApi(ctx: Context): Api["auth"] {
  return {
    async getSession(): Promise<AuthSession> {
      if (ctx.user) return { status: "authenticated", user: ctx.user };
      const users = await db().user.count();
      return { status: users === 0 ? "setup_required" : "unauthenticated", user: null };
    },

    async setup(rawInput): Promise<AuthSession> {
      if ((await db().user.count()) > 0) {
        throw forbidden("La configuration initiale a déjà été effectuée.");
      }
      const input = asRecord(rawInput);
      const name = validPersonName(input.name);
      const email = validEmail(input.email);
      const password = validPassword(input.password);
      const passwordHash = await hashPassword(password);

      try {
        const { user, token } = await db().$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_ID})::text`;
          if ((await tx.user.count()) > 0) {
            throw forbidden("La configuration initiale a déjà été effectuée.");
          }
          const created = await tx.user.create({
            data: { id: newId("usr"), name, email, passwordHash, role: "owner", status: "active" },
          });
          return { user: created, token: await createSession(created.id, ctx.client.userAgent, tx) };
        });
        ctx.session.set(token);
        return { status: "authenticated", user: toUserProfile(user) };
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("Cette adresse e-mail est déjà utilisée par un membre.", "email");
        }
        throw error;
      }
    },

    async login(rawInput): Promise<AuthSession> {
      const input = asRecord(rawInput);
      const email = normalizeEmail(input.email);
      const password = asString(input.password);
      const key = loginKey(ctx.client.address, email);
      if (loginLockRemaining(key) > 0) {
        throw forbidden("Trop de tentatives de connexion. Réessayez dans une minute.");
      }

      const user = email ? await db().user.findUnique({ where: { email } }) : null;
      // Same work whether or not the account exists (or can sign in).
      const stored = user && user.status === "active" ? user.passwordHash : null;
      const valid = await verifyPassword(password, stored);
      if (!user || !valid) {
        recordLoginFailure(key);
        throw forbidden("E-mail ou mot de passe incorrect.");
      }

      clearLoginFailures(key);
      // A fresh session replaces the one the browser may still carry.
      await destroySession(ctx.session.token);
      ctx.session.set(await createSession(user.id, ctx.client.userAgent));
      return { status: "authenticated", user: toUserProfile(user) };
    },

    async logout(): Promise<void> {
      await destroySession(ctx.session.token);
      ctx.session.clear();
    },
  };
}
