import type { LogLine } from "@/lib/types";

import { familyOf } from "../generators/family";
import {
  crashedHistory,
  runningHistory,
  stoppedHistory,
  type RuntimeContext,
} from "../generators/runtime-logs";
import type { ContainerRecord, MockDb } from "../schema";
import { slugify } from "../text";
import { getSpeed } from "../timers";
import { stackHint } from "./services";

export function runtimeContext(db: MockDb, container: ContainerRecord): RuntimeContext | null {
  const service = db.services.find((item) => item.id === container.serviceId);
  if (!service) return null;
  const stack = stackHint(db, service);
  const source = service.source;
  return {
    containerId: container.id,
    sourceType: source.type,
    family: familyOf(service, stack),
    framework: stack,
    slug: slugify(service.name),
    port: service.config.port,
    version: source.type === "postgres" ? source.version : source.type === "docker" ? source.tag : "",
    startCommand: service.config.startCommand,
    firstBoot: false,
    healthcheckPath: service.config.healthcheckPath,
  };
}

/** Last runtime lines of a container, oldest first. */
export function containerLogLines(db: MockDb, container: ContainerRecord, now: number): LogLine[] {
  const context = runtimeContext(db, container);
  if (!context || !container.startedAt) return [];
  const startedAt = Date.parse(container.startedAt);
  const stoppedAt = container.stoppedAt ? Date.parse(container.stoppedAt) : now;

  switch (container.state) {
    case "running":
    case "paused":
      return runningHistory(context, startedAt, now, getSpeed());
    case "exited":
      return container.exitCode === 0
        ? stoppedHistory(context, startedAt, stoppedAt, getSpeed())
        : crashedHistory(context, stoppedAt, container.restartCount);
    default:
      // created / restarting: the process is not printing anything yet.
      return [];
  }
}
