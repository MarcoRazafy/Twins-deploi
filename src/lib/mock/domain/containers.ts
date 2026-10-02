import type { Container } from "@/lib/types";

import { familyOf } from "../generators/family";
import { averageNetworkRate, sampleLoad } from "../generators/metrics";
import { round } from "../generators/prng";
import type { ContainerRecord, MockDb } from "../schema";
import { stackHint } from "./services";

/** ±3 % around the baseline, different on every call. */
function wobble(): number {
  return 0.97 + Math.random() * 0.06;
}

/**
 * Public shape with live-looking stats: CPU and memory hover around the value
 * the metrics chart shows for the current minute, network counters grow with
 * the uptime. Everything is zero while the container is not running.
 */
export function toContainer(db: MockDb, record: ContainerRecord, now: number): Container {
  const container: Container & Partial<Pick<ContainerRecord, "stoppedAt">> = { ...record };
  delete container.stoppedAt;

  const service = db.services.find((item) => item.id === record.serviceId);
  if (record.state !== "running" || !record.startedAt || !service) {
    return { ...container, cpuPercent: 0, memoryUsageMb: 0, networkRxMb: 0, networkTxMb: 0 };
  }

  const family = familyOf(service, stackHint(db, service));
  const limits = { cpu: service.config.cpuLimit, memoryMb: record.memoryLimitMb };
  const load = sampleLoad(family, service.id, limits, now, 60_000);
  const network = averageNetworkRate(family, service.id);
  const uptimeSeconds = Math.max(0, (now - Date.parse(record.startedAt)) / 1000);

  return {
    ...container,
    // `docker stats` reports CPU relative to one core.
    cpuPercent: round(load.cpu * limits.cpu * wobble(), 2),
    memoryUsageMb: Math.min(record.memoryLimitMb, Math.round(load.memory * wobble())),
    networkRxMb: round((network.inKbps * uptimeSeconds) / 1024, 2),
    networkTxMb: round((network.outKbps * uptimeSeconds) / 1024, 2),
  };
}
