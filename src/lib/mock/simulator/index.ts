import { clearScriptCache } from "../domain/deployment-logs";
import type { MockDb } from "../schema";
import { clearAllTimers } from "../timers";
import { resumeBackups } from "./backups";
import { resumeDeployments } from "./deployments";
import { resumeDomains } from "./domains";
import { rearmRuntimeLogs } from "./runtime-logs";
import { resumeRestarts } from "./services";

/**
 * Picks up everything that was in flight when the database was loaded (or
 * reset): deployments, restarts, DNS checks, backups, and live log tails.
 */
export function resumeSimulations(db: MockDb): void {
  resumeDeployments(db);
  resumeRestarts(db);
  resumeDomains(db);
  resumeBackups(db);
  rearmRuntimeLogs();
}

/** Cancels every pending step. Log subscribers stay registered. */
export function stopSimulations(): void {
  clearAllTimers();
  clearScriptCache();
}
