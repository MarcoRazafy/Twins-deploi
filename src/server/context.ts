/**
 * Request context and access control. No HTTP here: the route handler builds
 * the Context, the namespaces only read it.
 */

import type { ApiError } from "@/lib/api/contract";
import type { MemberRole, UserProfile } from "@/lib/types";

import { forbidden } from "./errors";

/** Lets auth methods ask the route handler to set or clear the session cookie. */
export interface SessionControl {
  /** Raw cookie value of the current request, when it carries one. */
  readonly token: string | null;
  set(token: string): void;
  clear(): void;
}

export interface Context {
  user: UserProfile | null;
  role: MemberRole | null;
  via: "session" | "token" | "anonymous";
  session: SessionControl;
  /** Used for rate limiting and session bookkeeping. */
  client: { address: string; userAgent: string | null };
}

const NO_SESSION: SessionControl = { token: null, set: () => {}, clear: () => {} };

export function anonymousContext(): Context {
  return {
    user: null,
    role: null,
    via: "anonymous",
    session: NO_SESSION,
    client: { address: "local", userAgent: null },
  };
}

/** Context of the platform itself (worker, scripts): full rights, no cookie. */
export function systemContext(user: UserProfile): Context {
  return { ...anonymousContext(), user, role: user.role, via: "token" };
}

const ROLE_RANK: Record<MemberRole, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };

export function hasRole(role: MemberRole | null, minimum: MemberRole): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Writes of `settings` a developer may do: they only concern their own account. */
const OWN_ACCOUNT_METHODS = new Set([
  "settings.updateProfile",
  "settings.createToken",
  "settings.revokeToken",
]);

/**
 * Minimum role for an RPC method ("<namespace>.<method>"); null = public.
 * - auth.*                          → public
 * - list*, get*, search*            → viewer
 * - settings.* writes (incl. members) → admin, except the caller's own profile and tokens
 * - every other write               → developer
 */
const SENSITIVE_READ_NAMESPACES = new Set(["databases", "variables"]);

export function minimumRole(method: string): MemberRole | null {
  const [namespace, name = ""] = method.split(".");
  if (namespace === "auth") return null;
  if (/^(list|get|search)/.test(name)) {
    // These reads return secrets (database passwords, variable values, rows).
    return SENSITIVE_READ_NAMESPACES.has(namespace) ? "developer" : "viewer";
  }
  if (namespace === "settings" && !OWN_ACCOUNT_METHODS.has(method)) return "admin";
  return "developer";
}

export function signInRequired(): ApiError {
  return forbidden("Vous devez être connecté pour effectuer cette action.");
}

/** Throws `forbidden` when the context may not call `method`. */
export function authorize(ctx: Context, method: string): void {
  const minimum = minimumRole(method);
  if (minimum === null) return;
  if (!ctx.user) throw signInRequired();
  if (!hasRole(ctx.role, minimum)) {
    throw forbidden("Vous n’avez pas les droits nécessaires pour effectuer cette action.");
  }
}

/** The signed-in user, for methods that act on "me". */
export function requireUser(ctx: Context): UserProfile {
  if (!ctx.user) throw signInRequired();
  return ctx.user;
}
