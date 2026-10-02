/** Authentication of a request: session cookie first, then bearer token, else anonymous. */

import type { UserProfile } from "@/lib/types";

import { toUserProfile } from "../mappers/user";
import { resolveSession } from "./sessions";
import { bearerToken, resolveApiToken } from "./tokens";

export * from "./cookies";
export * from "./rate-limit";
export * from "./sessions";
export * from "./tokens";

export interface Authentication {
  user: UserProfile | null;
  via: "session" | "token" | "anonymous";
  /** The session expiry slid: re-issue the cookie. */
  refreshed: boolean;
}

export async function authenticate(input: {
  sessionToken: string | null;
  authorization: string | null;
}): Promise<Authentication> {
  const session = await resolveSession(input.sessionToken);
  if (session) {
    return { user: toUserProfile(session.user), via: "session", refreshed: session.refreshed };
  }
  const user = await resolveApiToken(bearerToken(input.authorization));
  if (user) return { user: toUserProfile(user), via: "token", refreshed: false };
  return { user: null, via: "anonymous", refreshed: false };
}
