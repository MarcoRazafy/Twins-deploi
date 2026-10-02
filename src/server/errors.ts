/**
 * ApiError factories. Messages are user-facing French, like the simulator's.
 */

import { ApiError } from "@/lib/api/contract";

/** `what` is the French noun of the missing thing: notFound("Projet") → "Projet introuvable." */
export function notFound(what: string): ApiError {
  return new ApiError("not_found", `${what} introuvable.`);
}

export function validation(message: string, field?: string): ApiError {
  return new ApiError("validation", message, field);
}

export function conflict(message: string, field?: string): ApiError {
  return new ApiError("conflict", message, field);
}

export function forbidden(message: string): ApiError {
  return new ApiError("forbidden", message);
}

export function unavailable(message: string): ApiError {
  return new ApiError("unavailable", message);
}

/**
 * HTTP status of an ApiError. `authenticated: false` turns `forbidden` into
 * 401 (the caller has to sign in) instead of 403 (signed in, not allowed).
 */
export function httpStatusFor(error: ApiError, authenticated = true): number {
  switch (error.code) {
    case "validation":
      return 400;
    case "forbidden":
      return authenticated ? 403 : 401;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "unavailable":
      return 503;
    default:
      return 500;
  }
}

/** True for a Prisma unique-constraint violation (lost race on a uniqueness check). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
  );
}
