/**
 * The conversation lives in sessionStorage (it survives navigation and reloads
 * of the tab, not a new tab) behind a tiny external store, so React reads it
 * with `useSyncExternalStore` and never needs an effect to hydrate it.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const STORAGE_KEY = "mini-railway:assistant";
const MAX_STORED_TURNS = 40;
const EMPTY: readonly ChatTurn[] = [];

let cache: readonly ChatTurn[] | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): readonly ChatTurn[] {
  if (raw === null) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    const turns: ChatTurn[] = [];
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const { role, content } = item as { role?: unknown; content?: unknown };
      if ((role === "user" || role === "assistant") && typeof content === "string") {
        turns.push({ role, content });
      }
    }
    return turns.slice(-MAX_STORED_TURNS);
  } catch {
    return EMPTY;
  }
}

function readStorage(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getConversation(): readonly ChatTurn[] {
  if (cache === null) cache = parse(readStorage());
  return cache;
}

export function getServerConversation(): readonly ChatTurn[] {
  return EMPTY;
}

export function setConversation(turns: readonly ChatTurn[]): void {
  cache = turns.slice(-MAX_STORED_TURNS);
  try {
    if (cache.length === 0) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage blocked or full: the conversation then lives in memory only.
  }
  for (const listener of listeners) listener();
}

export function subscribeConversation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
