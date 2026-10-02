/** Identifiers and secrets for records created after the seed. */

import { alphanumeric, hexString, type Rng } from "./generators/prng";

function cryptoRng(): Rng {
  return () => {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const buffer = new Uint32Array(1);
      crypto.getRandomValues(buffer);
      return buffer[0] / 4294967296;
    }
    return Math.random();
  };
}

const rng = cryptoRng();

export function randomHex(length: number): string {
  return hexString(rng, length);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomHex(10)}`;
}

/** 12 hex chars, like `docker ps`. */
export function newContainerId(): string {
  return randomHex(12);
}

export function newSha(): string {
  return randomHex(40);
}

export function newPassword(length = 32): string {
  return alphanumeric(rng, length);
}

export function randomBetween(min: number, max: number): number {
  return min + rng() * (max - min);
}

export function randomInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
