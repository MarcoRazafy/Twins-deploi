"use client";

import { useMemo } from "react";

import { useProjects, useServices } from "@/lib/queries";
import type { Project, Service } from "@/lib/types";

/** Name lookups for rows: services and projects are cached app-wide, so this is free. */
export function useDeploymentLookups() {
  const services = useServices();
  const projects = useProjects();

  const serviceById = useMemo(
    () => new Map<string, Service>((services.data ?? []).map((service) => [service.id, service])),
    [services.data],
  );
  const projectById = useMemo(
    () => new Map<string, Project>((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );

  return { serviceById, projectById, isLoading: services.isPending || projects.isPending };
}
