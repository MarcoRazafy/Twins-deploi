"use client";

import { useSyncExternalStore } from "react";

interface Ticker {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

// One ticker per interval, shared by every component that asks for it.
const tickers = new Map<number, Ticker>();

function createTicker(intervalMs: number): Ticker {
  const listeners = new Set<() => void>();
  let now = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    now = Date.now();
    for (const listener of listeners) listener();
  };

  // Timers are throttled in background tabs: catch up when coming back.
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") tick();
  };

  // The value only moves after a full interval, so repeated reads within one
  // render agree.
  const refreshIfStale = () => {
    const current = Date.now();
    if (current - now >= intervalMs) now = current;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        // After hydration nothing has read the clock yet (the server snapshot
        // was used): start from the real time instead of waiting for a tick.
        refreshIfStale();
        timer = setInterval(tick, intervalMs);
        document.addEventListener("visibilitychange", onVisibilityChange);
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
          document.removeEventListener("visibilitychange", onVisibilityChange);
        }
      };
    },
    getSnapshot() {
      // No subscriber means no timer: refresh lazily so a component mounting
      // after an idle period does not start from a stale time.
      if (listeners.size === 0) refreshIfStale();
      return now;
    },
  };
}

function getTicker(intervalMs: number): Ticker {
  let ticker = tickers.get(intervalMs);
  if (!ticker) {
    ticker = createTicker(intervalMs);
    tickers.set(intervalMs, ticker);
  }
  return ticker;
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * Current time in epoch milliseconds, refreshed every `intervalMs`. This is
 * how render code gets "now" without calling `Date.now()` (impure in render).
 *
 * Returns 0 on the server and during hydration: treat 0 as "not ticking yet"
 * and render a neutral fallback. Use a short interval (1000) for live timers.
 */
export function useNow(intervalMs = 30_000): number {
  const ticker = getTicker(intervalMs);
  return useSyncExternalStore(ticker.subscribe, ticker.getSnapshot, getServerSnapshot);
}
