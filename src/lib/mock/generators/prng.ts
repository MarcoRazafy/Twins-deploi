/** Seeded pseudo-random helpers: everything "random but stable" goes through here. */

export type Rng = () => number;

/** FNV-1a, 32 bits. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generator seeded by any combination of strings and numbers. */
export function seededRng(...parts: Array<string | number>): Rng {
  return mulberry32(hashString(parts.join("|")));
}

/** Stateless value in [0, 1) for a (seed, index) pair. */
export function noise(seed: number, index: number): number {
  let t = (seed ^ Math.imul(index | 0, 0x9e3779b1)) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/** Integer in [min, max], both inclusive. */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function randFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

const HEX = "0123456789abcdef";

export function hexString(rng: Rng, length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += HEX[Math.floor(rng() * 16)];
  }
  return out;
}

const ALPHANUMERIC =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function alphanumeric(rng: Rng, length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += ALPHANUMERIC[Math.floor(rng() * ALPHANUMERIC.length)];
  }
  return out;
}

export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
