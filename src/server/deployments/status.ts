/**
 * Deployment lifecycle vocabulary shared by the API, the SSE route and the worker.
 *
 * Cancellation protocol (API <-> worker):
 * - queued: the API cancels it immediately (status "cancelled", error set).
 * - building / deploying: the API only sets `cancelRequested`. The worker stops
 *   at its next checkpoint, kills the running command, then ends the deployment
 *   with status "cancelled" and `cancellationError(...)` as the reason. It does
 *   not record an activity (the API already did, when it was a user action).
 * - Service status: a worker ending a deployment without going live restores the
 *   service status ("online" when it has an active deployment, "crashed"
 *   otherwise) only when no other deployment of the service is in flight AND the
 *   service status is still "building" / "deploying". Every worker write of the
 *   service status must be conditional on that (a user may have stopped the
 *   service meanwhile).
 */

import type { DeploymentStatus } from "@/lib/types";

export const IN_FLIGHT_STATUSES = ["queued", "building", "deploying"] as const;

/** No more log lines will be produced for a deployment in one of these states. */
export const FINISHED_STATUSES = ["active", "failed", "crashed", "cancelled", "removed"] as const;

export const DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = [
  ...IN_FLIGHT_STATUSES,
  ...FINISHED_STATUSES,
];

export const CANCELLED_ERROR = "Annulé par l’utilisateur";
export const SUPERSEDED_ERROR = "Remplacé par un déploiement plus récent";

export function isInFlight(status: DeploymentStatus): boolean {
  return IN_FLIGHT_STATUSES.some((candidate) => candidate === status);
}

export function isFinished(status: DeploymentStatus): boolean {
  return FINISHED_STATUSES.some((candidate) => candidate === status);
}

/**
 * Reason stored when a running deployment ends cancelled: superseded when the
 * service has a newer deployment, cancelled by the user otherwise (explicit
 * cancel, or the service was stopped).
 */
export function cancellationError(deploymentId: string, latestDeploymentId: string | null): string {
  return latestDeploymentId !== null && latestDeploymentId !== deploymentId
    ? SUPERSEDED_ERROR
    : CANCELLED_ERROR;
}
