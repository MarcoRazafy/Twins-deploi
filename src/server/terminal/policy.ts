/**
 * Pure checks of the terminal service on an incoming WebSocket handshake.
 * No I/O here: the service (./server.ts) does the lookups.
 */

import { SESSION_COOKIE } from "../auth/cookies";

/**
 * A WebSocket handshake is not covered by the same-origin policy: any page can
 * open one, and the browser attaches the cookies it is allowed to send. Unlike
 * `passesCsrf`, a missing Origin is therefore a refusal: browsers always send it.
 */
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    originHost = url.host.toLowerCase();
  } catch {
    return false;
  }
  // Behind NGINX and the Next.js rewrite, Host is the service's own address:
  // the name the browser called is in X-Forwarded-Host.
  const forwarded = headers.get("x-forwarded-host");
  const called = (forwarded ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  return called !== "" && called === originHost;
}

/** Value of the session cookie in a raw Cookie header, or null. */
export function sessionTokenFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return value === "" ? null : value;
  }
  return null;
}

/** "2 min", "1 h 05" - for the activity journal. */
export function formatSessionDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "moins d’une minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}
