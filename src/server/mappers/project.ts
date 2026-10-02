import type { Project as ProjectRow } from "@/generated/prisma/client";
import {
  PROJECT_COLORS,
  REGIONS,
  type DeploymentStatus,
  type Project,
  type ProjectStats,
  type ProjectSummary,
  type ServiceStatus,
  type ServiceType,
} from "@/lib/types";

/** What a project summary needs besides the project row (computed with grouped queries). */
export interface ProjectAggregates {
  /** Oldest first: the order in which the project was assembled. */
  services: Array<{ id: string; name: string; type: ServiceType; status: ServiceStatus }>;
  domains: number;
  variables: number;
  deployments: number;
  /** Newest deployment of the project, any service. */
  lastDeployment: {
    id: string;
    serviceId: string;
    status: DeploymentStatus;
    createdAt: Date;
  } | null;
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    // Validated on write; the fallbacks only protect against hand-edited rows.
    color: PROJECT_COLORS.find((color) => color === row.color) ?? "purple",
    environment: row.environment,
    region: REGIONS.find((region) => region === row.region) ?? "eu-west",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProjectSummary(row: ProjectRow, aggregates: ProjectAggregates): ProjectSummary {
  const { services } = aggregates;
  const count = (...statuses: ServiceStatus[]): number =>
    services.filter((service) => statuses.includes(service.status)).length;

  const stats: ProjectStats = {
    services: services.length,
    databases: services.filter((service) => service.type === "postgres").length,
    online: count("online"),
    inProgress: count("building", "deploying", "restarting"),
    crashed: count("crashed"),
    stopped: count("stopped"),
    domains: aggregates.domains,
    variables: aggregates.variables,
    deployments: aggregates.deployments,
  };

  const last = aggregates.lastDeployment;
  return {
    ...toProject(row),
    stats,
    services: services.map(({ id, name, type, status }) => ({ id, name, type, status })),
    lastDeployment: last
      ? {
          id: last.id,
          serviceId: last.serviceId,
          status: last.status,
          createdAt: last.createdAt.toISOString(),
        }
      : null,
  };
}
