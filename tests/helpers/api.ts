/**
 * In-process access to the server API, the way the RPC route uses it
 * (src/app/api/rpc/route.ts): `authorize(ctx, method)` first, then the
 * namespace method. No HTTP, no cookie: a Context is built by hand.
 */

import { isApiError, type Api, type ApiError, type ApiErrorCode } from "@/lib/api/contract";
import type { MemberRole, Service, UserProfile } from "@/lib/types";
import { createServerApi } from "@/server/api";
import { anonymousContext, authorize, systemContext, type Context } from "@/server/context";
import { db } from "@/server/db";

export const OWNER = {
  name: "Test Owner",
  email: "owner@example.test",
  password: "Motdepasse-solide-42",
} as const;

/** Methods that are never reachable through RPC (see NOT_CALLABLE in src/server/api). */
const NOT_CALLABLE = new Set(["events.subscribe", "deployments.subscribeLogs", "docker.subscribeContainerLogs"]);

/** The Api of `ctx`, every RPC method guarded by `authorize` exactly like the route does. */
export function guardedApi(ctx: Context): Api {
  const raw = createServerApi(ctx) as unknown as Record<string, Record<string, unknown>>;
  const guarded: Record<string, Record<string, unknown>> = {};
  for (const [namespace, methods] of Object.entries(raw)) {
    guarded[namespace] = {};
    for (const [name, value] of Object.entries(methods)) {
      const method = `${namespace}.${name}`;
      if (typeof value !== "function" || NOT_CALLABLE.has(method)) {
        guarded[namespace][name] = value;
        continue;
      }
      const fn = value as (...args: unknown[]) => Promise<unknown>;
      guarded[namespace][name] = async (...args: unknown[]) => {
        authorize(ctx, method);
        return fn(...args);
      };
    }
  }
  return guarded as unknown as Api;
}

/** Guarded Api of a signed-in user (role taken from the profile). */
export function apiAs(user: UserProfile): Api {
  return guardedApi(systemContext(user));
}

/** Guarded Api of an anonymous visitor. */
export function anonymousApi(): Api {
  return guardedApi(anonymousContext());
}

/** First run: creates the owner account through auth.setup and returns its profile. */
export async function setupOwner(): Promise<UserProfile> {
  const session = await createServerApi(anonymousContext()).auth.setup({ ...OWNER });
  if (!session.user) throw new Error("auth.setup returned no user");
  return session.user;
}

let memberCount = 0;

/**
 * A member with `role`, invited by `owner` through settings.inviteMember, then
 * marked active (as if they had accepted the invitation).
 */
export async function createMember(owner: UserProfile, role: Exclude<MemberRole, "owner">): Promise<UserProfile> {
  memberCount += 1;
  const member = await apiAs(owner).settings.inviteMember({
    email: `${role}-${memberCount}@example.test`,
    role,
  });
  await db().user.update({ where: { id: member.id }, data: { status: "active" } });
  return { id: member.id, name: member.name, email: member.email, role: member.role, avatarUrl: member.avatarUrl };
}

/** Docker-image service (no Docker needed: only rows and a queued deployment). */
export function deployImage(
  api: Api,
  projectId: string,
  name: string,
  options: { image?: string; port?: number; variables?: Array<{ key: string; value: string }> } = {},
): Promise<Service> {
  return api.docker.deployImage({
    projectId,
    image: options.image ?? "nginx",
    tag: "1.27",
    name,
    port: options.port ?? 8080,
    variables: options.variables,
  });
}

/** Expects `promise` to reject with an ApiError of `code` (and `field` when given). */
export async function expectApiError(
  promise: Promise<unknown>,
  code: ApiErrorCode,
  field?: string,
): Promise<ApiError> {
  const error: unknown = await promise.then(
    () => {
      throw new Error(`expected an ApiError "${code}", the call resolved`);
    },
    (reason: unknown) => reason,
  );
  if (!isApiError(error)) throw error;
  if (error.code !== code || (field !== undefined && error.field !== field)) {
    throw new Error(
      `expected ApiError ${code}${field ? `/${field}` : ""}, got ${error.code}/${error.field ?? "-"}: ${error.message}`,
    );
  }
  return error;
}
