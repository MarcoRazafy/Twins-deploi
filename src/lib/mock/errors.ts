import { ApiError } from "@/lib/api/contract";

export function notFound(what: string): ApiError {
  return new ApiError("not_found", `${what} introuvable.`);
}

export function invalid(message: string, field?: string): ApiError {
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
