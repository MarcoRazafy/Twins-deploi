/**
 * Server implementation of the contract.
 *
 * One file per namespace, `./<namespace>.ts`, exporting
 * `create<Namespace>Api(ctx: Context): Api["<namespace>"]`, assembled below.
 */

import type { Api } from "@/lib/api/contract";

import { anonymousContext, type Context } from "../context";
import { subscribeEvents } from "../events";
import { createActivityApi } from "./activity";
import { createAuthApi } from "./auth";
import { createDatabasesApi } from "./databases";
import { createDeploymentsApi } from "./deployments";
import { createDockerApi } from "./docker";
import { createDomainsApi } from "./domains";
import { createGithubApi } from "./github";
import { createMetricsApi } from "./metrics";
import { createProjectsApi } from "./projects";
import { createServicesApi } from "./services";
import { createSettingsApi } from "./settings";
import { createVariablesApi } from "./variables";

export function createServerApi(ctx: Context): Api {
  return {
    auth: createAuthApi(ctx),
    projects: createProjectsApi(ctx),
    services: createServicesApi(ctx),
    deployments: createDeploymentsApi(ctx),
    variables: createVariablesApi(ctx),
    domains: createDomainsApi(ctx),
    github: createGithubApi(ctx),
    docker: createDockerApi(ctx),
    databases: createDatabasesApi(ctx),
    metrics: createMetricsApi(ctx),
    activity: createActivityApi(ctx),
    settings: createSettingsApi(ctx),
    events: { subscribe: subscribeEvents },
  };
}

/** Subscriptions are served by the SSE routes, never through RPC. */
const NOT_CALLABLE = new Set([
  "events.subscribe",
  "deployments.subscribeLogs",
  "docker.subscribeContainerLogs",
]);

/** "<namespace>.<method>" of every function of `api` that RPC may call. */
export function listRpcMethods(api: Api): string[] {
  const names: string[] = [];
  for (const [namespace, methods] of Object.entries(api)) {
    for (const [name, value] of Object.entries(methods)) {
      const method = `${namespace}.${name}`;
      if (typeof value === "function" && !NOT_CALLABLE.has(method)) names.push(method);
    }
  }
  return names;
}

let rpcMethods: ReadonlySet<string> | null = null;

/** Whitelist of the RPC endpoint, derived once from the server object. */
export function getRpcMethods(): ReadonlySet<string> {
  rpcMethods ??= new Set(listRpcMethods(createServerApi(anonymousContext())));
  return rpcMethods;
}

/** Calls a whitelisted method with untrusted arguments. */
export function callRpcMethod(api: Api, method: string, args: unknown[]): Promise<unknown> {
  if (!getRpcMethods().has(method)) {
    throw new Error(`Not an RPC method: ${method}`);
  }
  const [namespace, name] = method.split(".");
  const target = (api as unknown as Record<string, Record<string, (...input: unknown[]) => unknown>>)[
    namespace
  ][name];
  return Promise.resolve(target(...args));
}
