/**
 * Profile photo rules, shared by the client (upload), the simulator and the
 * backend so a photo accepted in one place is accepted everywhere.
 */

/** Edge, in pixels, of the square the browser resizes a photo to. */
export const AVATAR_SIZE_PX = 256;

/** Largest decoded photo the API stores. */
export const AVATAR_MAX_BYTES = 200 * 1024;

/** Largest file the browser agrees to read before resizing it. */
export const AVATAR_MAX_FILE_BYTES = 5 * 1024 * 1024;

export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Size in bytes of a base64 payload once decoded. */
function decodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * French error message when `value` is not an acceptable photo (a PNG, JPEG or
 * WebP data URL of at most 200 Ko), `null` when it is.
 */
export function avatarProblem(value: unknown): string | null {
  if (typeof value !== "string") return "La photo doit être une image PNG, JPEG ou WebP.";
  const match = DATA_URL.exec(value);
  if (!match || match[1].length % 4 !== 0) {
    return "La photo doit être une image PNG, JPEG ou WebP.";
  }
  if (decodedBytes(match[1]) > AVATAR_MAX_BYTES) {
    return "La photo est trop lourde : 200 Ko au maximum.";
  }
  return null;
}
