/**
 * Tiny in-memory cache with a time to live. It stores the promise, so that
 * concurrent callers share a single GitHub request, and forgets failures.
 */

interface Entry<T> {
  expires: number;
  value: Promise<T>;
}

export interface TtlCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function createTtlCache<T>(ttlMs: number, maxEntries: number): TtlCache<T> {
  const entries = new Map<string, Entry<T>>();

  return {
    get(key, load) {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && hit.expires > now) return hit.value;

      const value = load();
      entries.set(key, { expires: now + ttlMs, value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });

      for (const [name, entry] of entries) {
        if (entry.expires <= now) entries.delete(name);
      }
      // Oldest insertions first (Map keeps insertion order).
      for (const name of entries.keys()) {
        if (entries.size <= maxEntries) break;
        entries.delete(name);
      }
      return value;
    },
    clear() {
      entries.clear();
    },
  };
}
