/**
 * Server side of the platform variables (src/lib/variables/builtin.ts): loads
 * what they are computed from.
 */

import type { Domain, Project, Service } from "@/generated/prisma/client";
import {
  builtinVariables,
  pickPublicDomain,
  type BuiltinVariable,
  type BuiltinVariableSource,
} from "@/lib/variables/builtin";

import { db, type DbClient } from "../db";
import { notFound } from "../errors";
import { isLocalHostname } from "../proxy";

type ServiceFields = Pick<Service, "id" | "name" | "slug" | "port" | "volumeName" | "volumeMountPath" | "primaryDomain">;
type ProjectFields = Pick<Project, "id" | "name" | "slug" | "environment" | "region">;
type DomainFields = Pick<Domain, "serviceId" | "hostname" | "kind" | "status" | "createdAt">;

export const BUILTIN_SERVICE_SELECT = {
  id: true,
  name: true,
  slug: true,
  port: true,
  volumeName: true,
  volumeMountPath: true,
  primaryDomain: true,
} as const;

export const BUILTIN_PROJECT_SELECT = {
  id: true,
  name: true,
  slug: true,
  environment: true,
  region: true,
} as const;

export const BUILTIN_DOMAIN_SELECT = {
  serviceId: true,
  hostname: true,
  kind: true,
  status: true,
  createdAt: true,
} as const;

/** Pure: the platform variables of a service from already loaded rows. */
export function builtinVariablesOf(
  project: ProjectFields,
  service: ServiceFields,
  domains: readonly DomainFields[],
  deploymentId: string | null,
): BuiltinVariable[] {
  const own = domains
    .filter((domain) => domain.serviceId === service.id)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const source: BuiltinVariableSource = {
    project,
    service: {
      id: service.id,
      name: service.name,
      slug: service.slug,
      port: service.port,
      volume:
        service.volumeName !== null && service.volumeMountPath !== null
          ? { name: service.volumeName, mountPath: service.volumeMountPath }
          : null,
    },
    publicDomain: pickPublicDomain(service.primaryDomain, own, isLocalHostname),
    deploymentId,
  };
  return builtinVariables(source);
}

export async function loadBuiltinVariables(
  serviceId: string,
  deploymentId: string | null,
  client: DbClient = db(),
): Promise<BuiltinVariable[]> {
  const service = await client.service.findUnique({
    where: { id: serviceId },
    select: { ...BUILTIN_SERVICE_SELECT, project: { select: BUILTIN_PROJECT_SELECT } },
  });
  if (!service) throw notFound("Service");
  const domains = await client.domain.findMany({ where: { serviceId }, select: BUILTIN_DOMAIN_SELECT });
  return builtinVariablesOf(service.project, service, domains, deploymentId);
}
