/**
 * Naming conventions shared by the API, the deployment pipeline and the cleanup
 * jobs. Everything is derived from generated ids, so renaming a project or a
 * service never orphans a Docker object or a directory.
 */

import path from "node:path";

import { env } from "../env";

/** Docker network of a project; its services reach each other through it. */
export function projectNetworkName(projectId: string): string {
  return `mr-${projectId}`;
}

/** Named Docker volume of a service. Kept across redeployments and detaching. */
export function volumeNameFor(serviceId: string): string {
  return `mr-${serviceId}-data`;
}

/** Repository (no tag) of the images built for a GitHub service; one tag per deployment id. */
export function imageRepositoryFor(serviceId: string): string {
  return `mini-railway/${serviceId}`;
}

/** Local clone of a GitHub service: <data dir>/repos/<serviceId>. */
export function repoDirectoryFor(serviceId: string): string {
  return path.join(env.dataDir, "repos", serviceId);
}
