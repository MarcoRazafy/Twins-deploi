/** Artificial network latency, so loading states are real. */

let factor = 1;

/** 1 = realistic, 0 = instant (dev hook). */
export function setLatency(value: number): void {
  factor = Number.isFinite(value) && value >= 0 ? value : 1;
}

function wait(minMs: number, maxMs: number): Promise<void> {
  const ms = (minMs + Math.random() * (maxMs - minMs)) * factor;
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const latency = {
  read: () => wait(150, 400),
  write: () => wait(350, 700),
  /** Simulated OAuth round-trip. */
  oauth: () => wait(1400, 1700),
} as const;
