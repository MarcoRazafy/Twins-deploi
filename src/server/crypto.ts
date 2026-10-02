/**
 * Cryptographic helpers: secrets at rest (AES-256-GCM), passwords (scrypt),
 * token fingerprints (SHA-256), randomness and constant-time comparison.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

import { env } from "./env";

// ─── Secrets at rest ─────────────────────────────────────────────────────────

const SECRET_VERSION = "v1";

function secretKey(): Buffer {
  return Buffer.from(env.secretKey, "hex");
}

/** "v1:<iv>:<tag>:<ciphertext>", every part base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/** Throws when the payload is malformed, tampered with or sealed with another key. */
export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== SECRET_VERSION) {
    throw new Error("Unsupported secret payload.");
  }
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("Malformed secret payload.");
  }
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ─── Passwords ───────────────────────────────────────────────────────────────

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_SCRYPT_N = 2 ** 17;

function deriveKey(
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Node's default maxmem (32 MB) is just below what N=2^15, r=8 needs.
    scrypt(password, salt, length, { N, r, p, maxmem: 256 * N * r }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** "scrypt$N$r$p$<salt>$<hash>" (salt and hash base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, KEY_BYTES);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

let dummyHash: Promise<string> | null = null;

/**
 * Constant-time path: with no stored hash (unknown e-mail, invited member) the
 * same derivation still runs against a throw-away hash, then returns false.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null) {
    dummyHash ??= hashPassword(randomToken(16));
    await verifyAgainst(password, await dummyHash);
    return false;
  }
  return verifyAgainst(password, stored);
}

async function verifyAgainst(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isInteger(N) || N < 2 || N > MAX_SCRYPT_N ||
    !Number.isInteger(r) || r < 1 || r > 16 ||
    !Number.isInteger(p) || p < 1 || p > 4
  ) {
    return false;
  }
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length === 0 || expected.length === 0 || expected.length > 128) return false;
  try {
    const actual = await deriveKey(password, salt, N, r, p, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** `bytes` random bytes, base64url encoded. */
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/** `bytes` random bytes, hexadecimal. */
export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** Constant-time string comparison (digests first, so lengths do not leak). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}
