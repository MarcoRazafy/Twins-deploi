/**
 * Registry of every simulator timer, so a reset can cancel them all and a
 * re-scheduled step replaces the pending one instead of piling up.
 */

export const isBrowser = typeof window !== "undefined";

let speed = 1;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function getSpeed(): number {
  return speed;
}

/** Every simulator duration is divided by this multiplier (dev hook). */
export function setSpeed(multiplier: number): void {
  speed =
    Number.isFinite(multiplier) && multiplier > 0
      ? Math.min(Math.max(multiplier, 0.1), 200)
      : 1;
}

/** Runs `run` once, `wallMs` of real time from now. Browser only. */
export function afterExact(key: string, wallMs: number, run: () => void): void {
  if (!isBrowser) return;
  cancelTimer(key);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      run();
    }, Math.max(0, wallMs)),
  );
}

/** Runs `run` once after `nominalMs` of simulated time. Browser only. */
export function after(key: string, nominalMs: number, run: () => void): void {
  afterExact(key, nominalMs / speed, run);
}

export function cancelTimer(key: string): void {
  const handle = timers.get(key);
  if (handle === undefined) return;
  clearTimeout(handle);
  timers.delete(key);
}

export function hasTimer(key: string): boolean {
  return timers.has(key);
}

export function clearAllTimers(): void {
  for (const handle of timers.values()) clearTimeout(handle);
  timers.clear();
}

export function activeTimerCount(): number {
  return timers.size;
}

export const timerKey = {
  deployment: (id: string) => `deployment:${id}`,
  service: (id: string) => `service:${id}`,
  domain: (id: string) => `domain:${id}`,
  backup: (id: string) => `backup:${id}`,
  runtimeLogs: (id: number) => `runtime-logs:${id}`,
} as const;
