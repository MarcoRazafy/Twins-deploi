import { randomBytes } from "node:crypto";

/** Readable prefixes of the application-generated ids. */
export type IdPrefix =
  | "prj"
  | "svc"
  | "con"
  | "dep"
  | "var"
  | "dom"
  | "db"
  | "bkp"
  | "act"
  | "usr"
  | "ses"
  | "tok"
  | "job";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 16;
// Largest multiple of 36 below 256: bytes above it are rejected to avoid modulo bias.
const UNBIASED_LIMIT = 252;

/** "<prefix>_<16 lowercase base36 chars>", e.g. "prj_k3v9x0a7m2q8d1zc". */
export function newId(prefix: IdPrefix): string {
  let suffix = "";
  while (suffix.length < ID_LENGTH) {
    for (const byte of randomBytes(ID_LENGTH * 2)) {
      if (byte >= UNBIASED_LIMIT) continue;
      suffix += ALPHABET[byte % ALPHABET.length];
      if (suffix.length === ID_LENGTH) break;
    }
  }
  return `${prefix}_${suffix}`;
}
