import { routes } from "@/lib/routes";

export const LOGIN_PATH = "/login";
export const SETUP_PATH = "/setup";

const DEFAULT_DESTINATION = routes.dashboard();

/** Never a real origin: it only lets `URL` parse a relative path. */
const PROBE_ORIGIN = "https://mini-railway.invalid";

/** `/login?next=<where the visitor was going>`. */
export function loginHref(next?: string): string {
  return next ? `${LOGIN_PATH}?${new URLSearchParams({ next }).toString()}` : LOGIN_PATH;
}

/**
 * Where to go once signed in. `next` comes from the URL, so it is untrusted:
 * only a path of this app is followed, never another site ("//evil.test",
 * "/\evil.test") and never the sign-in screens themselves, which would bounce
 * straight back.
 */
export function resolveNextPath(next: string | null): string {
  if (!next || !next.startsWith("/")) return DEFAULT_DESTINATION;

  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return DEFAULT_DESTINATION;
  }
  if (url.origin !== PROBE_ORIGIN) return DEFAULT_DESTINATION;

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const isAuthScreen = path === LOGIN_PATH || path === SETUP_PATH;
  const isApi = path === "/api" || path.startsWith("/api/");
  if (isAuthScreen || isApi) return DEFAULT_DESTINATION;

  return `${url.pathname}${url.search}`;
}
