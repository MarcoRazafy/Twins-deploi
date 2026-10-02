/**
 * HTTP glue shared by the route handlers (web-only by usage, but free of
 * next/* imports: it works on standard Request/Headers objects).
 */

import { ApiError } from "@/lib/api/contract";

import { httpStatusFor } from "./errors";

export const CSRF_HEADER = "x-mini-railway";

/** Address used for login throttling. */
export function clientAddress(headers: Headers): string {
  // NGINX appends the real peer address last; earlier entries come from the client.
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const last = forwarded.split(",").pop()?.trim();
    if (last) return last.slice(0, 64);
  }
  return "local";
}

/** CSRF rule: custom header present, and a sent Origin must be the host that was called. */
export function passesCsrf(headers: Headers): boolean {
  if (!headers.get(CSRF_HEADER)) return false;
  const origin = headers.get("origin");
  if (origin === null) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const hosts = [headers.get("host"), headers.get("x-forwarded-host")]
    .filter((host): host is string => host !== null)
    .map((host) => host.split(",")[0].trim().toLowerCase());
  return hosts.includes(originHost);
}

export interface ErrorBody {
  error: { code: ApiError["code"]; message: string; field?: string };
}

/** Body and status for anything thrown; unexpected errors are logged, never leaked. */
export function errorResponse(
  error: unknown,
  authenticated: boolean,
  label: string,
): { status: number; body: ErrorBody } {
  if (error instanceof ApiError) {
    return {
      status: httpStatusFor(error, authenticated),
      body: { error: { code: error.code, message: error.message, field: error.field } },
    };
  }
  console.error(`[api] ${label} failed:`, error);
  return {
    status: 500,
    body: { error: { code: "unknown", message: "Une erreur inattendue est survenue." } },
  };
}

/** Reads a request body as text, or null when it exceeds `limit` bytes. */
export async function readBodyText(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
