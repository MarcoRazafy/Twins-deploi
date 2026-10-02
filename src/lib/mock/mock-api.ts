import type { Api } from "@/lib/api/contract";

import { activityApi } from "./api/activity";
import { authApi } from "./api/auth";
import { databasesApi } from "./api/databases";
import { deploymentsApi } from "./api/deployments";
import { dockerApi } from "./api/docker";
import { domainsApi } from "./api/domains";
import { githubApi } from "./api/github";
import { metricsApi } from "./api/metrics";
import { projectsApi } from "./api/projects";
import { servicesApi } from "./api/services";
import { settingsApi } from "./api/settings";
import { variablesApi } from "./api/variables";
import { setReadyHandler } from "./db";
import { installDevHook } from "./dev-hook";
import { subscribe } from "./emitter";
import { resumeSimulations } from "./simulator";

/**
 * In-browser implementation of the API contract.
 *
 * Creating it is free and safe during SSR: the database is only loaded (from
 * localStorage, or seeded) by the first call, and simulations only run in the
 * browser.
 */
export function createMockApi(): Api {
  // Whenever the database is loaded or reset, pick up what was in flight.
  setReadyHandler(resumeSimulations);

  const api: Api = {
    auth: authApi,
    projects: projectsApi,
    services: servicesApi,
    deployments: deploymentsApi,
    variables: variablesApi,
    domains: domainsApi,
    github: githubApi,
    docker: dockerApi,
    databases: databasesApi,
    metrics: metricsApi,
    activity: activityApi,
    settings: settingsApi,
    events: { subscribe },
  };

  installDevHook(api);
  return api;
}
