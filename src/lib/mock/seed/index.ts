/**
 * Demo dataset. Ids are deterministic (deep links survive a reset) and every
 * timestamp is relative to the seeding moment, so the demo never looks stale.
 */

import { failureReason } from "../domain/deployment-logs";
import { registryHost } from "../domain/images";
import type { MockDb } from "../schema";
import { iso } from "../text";
import { seedActivity } from "./activity";
import { createClock } from "./clock";
import { seedContainers, seedImages } from "./containers";
import { seedBackups, seedDatabases } from "./databases";
import { seedDeployments } from "./deployments";
import { seedDomains } from "./domains";
import { seedGithub } from "./github";
import { seedMembers, seedProfile, seedSettings, seedTokens } from "./platform";
import { seedConnections, seedProjects, seedServices } from "./projects";
import { seedVariables } from "./variables";

export function createSeed(now: number): MockDb {
  const clock = createClock(now);
  const settings = seedSettings();
  const registry = registryHost(settings.docker.registryUrl);

  const projects = seedProjects(clock);
  const services = seedServices(clock, settings);
  const deployments = seedDeployments(clock, services, projects, registry);
  const containers = seedContainers(clock, services, projects, deployments);
  const databases = seedDatabases(services, settings.baseDomain);

  const db: MockDb = {
    seededAt: iso(now),
    projects,
    services,
    connections: seedConnections(clock),
    deployments,
    variables: seedVariables(services, databases),
    domains: seedDomains(clock, settings),
    containers,
    images: seedImages(clock, containers, registry),
    databases,
    backups: seedBackups(clock),
    activity: [],
    github: seedGithub(clock),
    settings,
    profile: seedProfile(),
    members: seedMembers(clock),
    tokens: seedTokens(clock),
    pendingRestarts: {},
  };

  // The reason of a failure comes from the generator of its logs, so both agree.
  for (const deployment of db.deployments) {
    if (deployment.status === "failed") {
      deployment.error = failureReason(db, deployment, deployment.progress >= 75 ? "health" : "build");
    }
  }
  db.activity = seedActivity(clock, db.deployments, db.services);

  for (const service of db.services) {
    const container = containers.find((item) => item.serviceId === service.id);
    const lastChange = container?.stoppedAt ?? container?.startedAt;
    if (lastChange && lastChange > service.updatedAt) service.updatedAt = lastChange;
  }

  // Detach the result from the module-level seed tables it was built from.
  return structuredClone(db);
}
