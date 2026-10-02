/**
 * Login throttling, in memory (one web process): 5 failures for the same
 * client address + e-mail lock that pair for one minute.
 */

const MAX_FAILURES = 5;
const LOCK_MS = 60 * 1000;
const MAX_ENTRIES = 10_000;

interface Entry {
  failures: number;
  /** Epoch ms until which attempts are refused (0 = not locked). */
  lockedUntil: number;
  /** Epoch ms after which the entry is forgotten. */
  expiresAt: number;
}

const globalStore = globalThis as typeof globalThis & {
  __miniRailwayLoginAttempts?: Map<string, Entry>;
};
const attempts = (globalStore.__miniRailwayLoginAttempts ??= new Map());

export function loginKey(address: string, email: string): string {
  return `${address}|${email.slice(0, 254)}`;
}

function prune(now: number): void {
  if (attempts.size < MAX_ENTRIES) return;
  for (const [key, entry] of attempts) {
    if (entry.expiresAt <= now) attempts.delete(key);
  }
  // Still full of live entries: drop the oldest ones rather than grow without bound.
  for (const key of attempts.keys()) {
    if (attempts.size < MAX_ENTRIES) break;
    attempts.delete(key);
  }
}

/** Seconds left before another attempt is allowed (0 = allowed now). */
export function loginLockRemaining(key: string, now = Date.now()): number {
  const entry = attempts.get(key);
  if (!entry) return 0;
  if (entry.expiresAt <= now) {
    attempts.delete(key);
    return 0;
  }
  return entry.lockedUntil > now ? Math.ceil((entry.lockedUntil - now) / 1000) : 0;
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  prune(now);
  const current = attempts.get(key);
  const entry: Entry =
    current && current.expiresAt > now
      ? current
      : { failures: 0, lockedUntil: 0, expiresAt: now + LOCK_MS };
  entry.failures += 1;
  entry.expiresAt = now + LOCK_MS;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCK_MS;
    entry.failures = 0;
  }
  attempts.set(key, entry);
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}
