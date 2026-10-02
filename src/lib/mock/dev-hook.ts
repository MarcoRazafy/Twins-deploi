import type { Api } from "@/lib/api/contract";

import { setLatency } from "./latency";
import { isBrowser, setSpeed } from "./timers";

/** Debug handle exposed on `window` outside production builds. */
export interface MiniRailwayDevHook {
  api: Api;
  /** Restores the demo dataset. */
  reset(): Promise<void>;
  /** Multiplies the artificial latency (0 = instant, 1 = realistic). */
  setLatency(factor: number): void;
  /** Divides every simulator duration (10 = ten times faster). */
  setSpeed(multiplier: number): void;
}

declare global {
  interface Window {
    __miniRailway?: MiniRailwayDevHook;
  }
}

export function installDevHook(api: Api): void {
  if (!isBrowser || process.env.NODE_ENV === "production") return;
  window.__miniRailway = {
    api,
    reset: () => api.settings.resetDemoData(),
    setLatency,
    setSpeed,
  };
}
