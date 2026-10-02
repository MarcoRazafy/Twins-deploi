/** Session cookie definition (pure: usable from route handlers, no next/* import). */

export const SESSION_COOKIE = "mr_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  /** Seconds. */
  maxAge: number;
}

/** True when the browser reached the platform over HTTPS (directly or through NGINX). */
export function isSecureRequest(url: string, forwardedProto: string | null): boolean {
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim().toLowerCase() === "https";
  }
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionCookieOptions(secure: boolean): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
