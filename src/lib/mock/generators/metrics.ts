/**
 * Deterministic metric curves. Every value is a pure function of
 * (service id, wall-clock time), so refetching a range extends the same
 * curve instead of redrawing a different one.
 */

import type { MetricPoint, MetricRange, Service, ServiceMetrics } from "@/lib/types";

import type { Family } from "./family";
import { clamp, hashString, noise, round } from "./prng";

interface Profile {
  /** Average % of the CPU limit. */
  cpu: number;
  /** Average share of the memory limit. */
  mem: number;
  /** Requests (or queries, jobs) per minute. */
  rpm: number;
  /** p95 response time, ms. */
  rt: number;
  /** KB/s */
  netIn: number;
  netOut: number;
  /** 0 = flat all day, 1 = fully follows business hours. */
  seasonal: number;
}

const PROFILES: Record<Family, Profile> = {
  next: { cpu: 14, mem: 0.34, rpm: 180, rt: 190, netIn: 42, netOut: 310, seasonal: 0.75 },
  node: { cpu: 11, mem: 0.27, rpm: 260, rt: 85, netIn: 55, netOut: 140, seasonal: 0.75 },
  php: { cpu: 16, mem: 0.22, rpm: 120, rt: 240, netIn: 30, netOut: 190, seasonal: 0.75 },
  python: { cpu: 13, mem: 0.25, rpm: 90, rt: 210, netIn: 24, netOut: 110, seasonal: 0.7 },
  go: { cpu: 4, mem: 0.06, rpm: 150, rt: 22, netIn: 28, netOut: 64, seasonal: 0.7 },
  static: { cpu: 2, mem: 0.08, rpm: 60, rt: 12, netIn: 6, netOut: 120, seasonal: 0.8 },
  postgres: { cpu: 9, mem: 0.42, rpm: 900, rt: 6, netIn: 30, netOut: 85, seasonal: 0.6 },
  redis: { cpu: 3, mem: 0.05, rpm: 2400, rt: 1, netIn: 18, netOut: 22, seasonal: 0.5 },
  metabase: { cpu: 18, mem: 0.71, rpm: 24, rt: 420, netIn: 9, netOut: 75, seasonal: 0.85 },
  n8n: { cpu: 8, mem: 0.31, rpm: 12, rt: 310, netIn: 7, netOut: 12, seasonal: 0.3 },
  worker: { cpu: 22, mem: 0.3, rpm: 40, rt: 800, netIn: 14, netOut: 9, seasonal: 0.6 },
  web: { cpu: 3, mem: 0.07, rpm: 140, rt: 9, netIn: 12, netOut: 160, seasonal: 0.75 },
  generic: { cpu: 6, mem: 0.18, rpm: 80, rt: 60, netIn: 15, netOut: 40, seasonal: 0.5 },
};

export const RANGE_BUCKETS: Record<MetricRange, { points: number; stepMs: number }> = {
  "1h": { points: 60, stepMs: 60_000 },
  "6h": { points: 72, stepMs: 5 * 60_000 },
  "24h": { points: 96, stepMs: 15 * 60_000 },
  "7d": { points: 84, stepMs: 2 * 3_600_000 },
};

/** The demo lives in Madagascar: business hours are computed in UTC+3. */
const LOCAL_OFFSET_MS = 3 * 3_600_000;

function bump(hour: number, center: number, width: number): number {
  return Math.exp(-((hour - center) ** 2) / (2 * width * width));
}

/** About 0.15 at night, close to 1 at the morning and afternoon peaks. */
function dailyCurve(t: number): number {
  const local = t + LOCAL_OFFSET_MS;
  const hour = (((local / 3_600_000) % 24) + 24) % 24;
  const day = new Date(local).getUTCDay();
  const weekend = day === 0 || day === 6 ? 0.6 : 1;
  return (
    0.15 +
    weekend *
      (0.75 * bump(hour, 10.5, 2.2) + 0.65 * bump(hour, 15.5, 2.4) + 0.3 * bump(hour, 20.5, 1.6))
  );
}

function smoothNoise(seed: number, x: number): number {
  const index = Math.floor(x);
  const fraction = x - index;
  const eased = fraction * fraction * (3 - 2 * fraction);
  const from = noise(seed, index);
  return from + (noise(seed, index + 1) - from) * eased;
}

export interface LoadSample {
  cpu: number;
  memory: number;
  networkIn: number;
  networkOut: number;
  requests: number;
  responseTime: number;
}

const IDLE: LoadSample = {
  cpu: 0,
  memory: 0,
  networkIn: 0,
  networkOut: 0,
  requests: 0,
  responseTime: 0,
};

export function sampleLoad(
  family: Family,
  serviceId: string,
  limits: { cpu: number; memoryMb: number },
  t: number,
  stepMs: number,
): LoadSample {
  const profile = PROFILES[family];
  const seed = hashString(serviceId);
  const scale = 0.75 + 0.5 * noise(seed, 1);
  const bucket = Math.floor(t / stepMs);

  const activity = 1 - profile.seasonal + profile.seasonal * dailyCurve(t);
  const drift = smoothNoise(seed ^ 0x51ed, t / (25 * 60_000));
  const jitter = noise(seed ^ 0xa5a5, bucket);
  // Spikes are anchored on 15-minute windows so every range shows the same ones.
  const spikeRoll = noise(seed ^ 0x0f0f, Math.floor(t / (15 * 60_000)));
  const spike = spikeRoll > 0.965 ? 0.6 + (spikeRoll - 0.965) * 20 : 0;
  const load = activity * (0.7 + 0.45 * drift + 0.25 * jitter) + spike;

  const memoryShare =
    profile.mem * scale * (0.9 + 0.12 * drift + 0.05 * activity + 0.08 * spike);

  return {
    cpu: round(clamp(profile.cpu * scale * load, 0.1, 100), 1),
    memory: Math.round(clamp(limits.memoryMb * memoryShare, 8, limits.memoryMb * 0.97)),
    networkIn: round(profile.netIn * scale * load * (0.8 + 0.4 * jitter), 1),
    networkOut: round(
      profile.netOut * scale * load * (0.8 + 0.4 * noise(seed ^ 0x3c3c, bucket)),
      1,
    ),
    requests: Math.round(profile.rpm * scale * load),
    responseTime: Math.round(
      profile.rt * scale * (0.8 + 0.25 * jitter + 0.5 * spike + 0.25 * activity),
    ),
  };
}

/** Long-run average network rate (KB/s), used for cumulative counters. */
export function averageNetworkRate(
  family: Family,
  serviceId: string,
): { inKbps: number; outKbps: number } {
  const profile = PROFILES[family];
  const scale = 0.75 + 0.5 * noise(hashString(serviceId), 1);
  return { inKbps: profile.netIn * scale * 0.6, outKbps: profile.netOut * scale * 0.6 };
}

function bucketTimes(range: MetricRange, now: number): { times: number[]; stepMs: number } {
  const { points, stepMs } = RANGE_BUCKETS[range];
  const end = Math.floor(now / stepMs) * stepMs;
  const times = Array.from({ length: points }, (_, index) => end - (points - 1 - index) * stepMs);
  return { times, stepMs };
}

export function buildServiceMetrics(
  service: Service,
  family: Family,
  range: MetricRange,
  now: number,
): ServiceMetrics {
  const limits = { cpu: service.config.cpuLimit, memoryMb: service.config.memoryLimitMb };
  const { times, stepMs } = bucketTimes(range, now);
  const createdAt = Date.parse(service.createdAt);
  const online = service.status === "online";

  const samples = times.map((t) =>
    online && t + stepMs > createdAt ? sampleLoad(family, service.id, limits, t, stepMs) : IDLE,
  );
  const series = (key: keyof LoadSample): MetricPoint[] =>
    samples.map((sample, index) => ({ t: times[index], v: sample[key] }));

  return {
    serviceId: service.id,
    range,
    cpu: series("cpu"),
    memory: series("memory"),
    networkIn: series("networkIn"),
    networkOut: series("networkOut"),
    requests: series("requests"),
    responseTime: series("responseTime"),
    limits,
  };
}

/** The (single) host the platform runs on. */
export const HOST = {
  cpus: 8,
  memoryMb: 16_384,
  diskGb: 160,
  baseCpuPercent: 2.4,
  baseMemoryMb: 1_380,
  baseDiskGb: 14.2,
} as const;

export interface HostWorkload {
  service: Service;
  family: Family;
}

/** Host-level CPU (%) and memory (MB) over the last 24 h, from the online services. */
export function buildHostUsage(
  workloads: HostWorkload[],
  now: number,
): { cpu: MetricPoint[]; memory: MetricPoint[] } {
  const { times, stepMs } = bucketTimes("24h", now);
  const cpu: MetricPoint[] = [];
  const memory: MetricPoint[] = [];

  for (const t of times) {
    let cpuTotal: number = HOST.baseCpuPercent;
    let memoryTotal: number = HOST.baseMemoryMb;
    for (const { service, family } of workloads) {
      if (service.status !== "online" || t + stepMs <= Date.parse(service.createdAt)) continue;
      const limits = { cpu: service.config.cpuLimit, memoryMb: service.config.memoryLimitMb };
      const sample = sampleLoad(family, service.id, limits, t, stepMs);
      cpuTotal += (sample.cpu * limits.cpu) / HOST.cpus;
      memoryTotal += sample.memory;
    }
    cpu.push({ t, v: round(clamp(cpuTotal, 0, 100), 1) });
    memory.push({ t, v: Math.round(Math.min(memoryTotal, HOST.memoryMb)) });
  }

  return { cpu, memory };
}
