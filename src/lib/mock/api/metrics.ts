import type { Api } from "@/lib/api/contract";
import { METRIC_RANGES, type PlatformOverview } from "@/lib/types";

import { stackHint } from "../domain/services";
import { invalid } from "../errors";
import { familyOf } from "../generators/family";
import { buildHostUsage, buildServiceMetrics, HOST } from "../generators/metrics";
import { round } from "../generators/prng";
import { requireService } from "../lookup";
import { isInFlight, type MockDb } from "../schema";
import { DAY } from "../text";
import { read } from "./respond";

/** A deployment that went live counts as a success, even if it crashed later. */
const SUCCEEDED = new Set(["active", "removed", "crashed"]);

function overview(db: MockDb, now: number): PlatformOverview {
  const count = (...statuses: string[]) =>
    db.services.filter((service) => statuses.includes(service.status)).length;

  const lastWeek = db.deployments.filter((item) => now - Date.parse(item.createdAt) <= 7 * DAY);
  const succeeded = lastWeek.filter((item) => SUCCEEDED.has(item.status));
  const failed = lastWeek.filter((item) => item.status === "failed");
  const durations = succeeded.flatMap((item) => (item.durationMs === null ? [] : [item.durationMs]));

  // One bucket per local day, oldest first.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const deploymentsPerDay = Array.from({ length: 14 }, (_, index) => {
    const start = new Date(today);
    start.setDate(today.getDate() - (13 - index));
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const ofDay = db.deployments.filter((item) => {
      const createdAt = Date.parse(item.createdAt);
      return createdAt >= start.getTime() && createdAt < end.getTime();
    });
    return {
      date: start.toISOString(),
      succeeded: ofDay.filter((item) => SUCCEEDED.has(item.status)).length,
      failed: ofDay.filter((item) => item.status === "failed").length,
    };
  });

  const usage = buildHostUsage(
    db.services.map((service) => ({ service, family: familyOf(service, stackHint(db, service)) })),
    now,
  );
  const volumesGb = db.services.reduce((total, service) => total + (service.volume?.usedGb ?? 0), 0);
  const imagesGb = db.images.reduce((total, image) => total + image.sizeMb, 0) / 1024;
  const activeDomains = db.domains.filter((domain) => domain.status === "active").length;

  return {
    projects: db.projects.length,
    services: {
      total: db.services.length,
      online: count("online"),
      inProgress: count("building", "deploying", "restarting"),
      crashed: count("crashed"),
      stopped: count("stopped"),
    },
    databases: db.databases.length,
    domains: {
      total: db.domains.length,
      active: activeDomains,
      pending: db.domains.length - activeDomains,
    },
    deployments: {
      last24h: db.deployments.filter((item) => now - Date.parse(item.createdAt) <= DAY).length,
      successRate:
        succeeded.length + failed.length === 0
          ? 100
          : round((succeeded.length / (succeeded.length + failed.length)) * 100, 1),
      avgDurationMs:
        durations.length === 0
          ? 0
          : Math.round(durations.reduce((total, value) => total + value, 0) / durations.length),
      inProgress: db.deployments.filter(isInFlight).length,
    },
    deploymentsPerDay,
    resources: {
      // The gauges show the latest point of the usage curves.
      cpuPercent: usage.cpu[usage.cpu.length - 1]?.v ?? 0,
      memoryUsedMb: usage.memory[usage.memory.length - 1]?.v ?? 0,
      memoryTotalMb: HOST.memoryMb,
      diskUsedGb: round(HOST.baseDiskGb + volumesGb + imagesGb, 1),
      diskTotalGb: HOST.diskGb,
    },
    usage,
  };
}

export const metricsApi: Api["metrics"] = {
  getServiceMetrics: (serviceId, range) =>
    read((db) => {
      const service = requireService(db, serviceId);
      if (!METRIC_RANGES.includes(range)) {
        throw invalid("Cette période n’est pas disponible.", "range");
      }
      return buildServiceMetrics(service, familyOf(service, stackHint(db, service)), range, Date.now());
    }),

  getOverview: () => read((db) => overview(db, Date.now())),
};
