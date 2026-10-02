"use client";

import { Compass } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/contract";
import {
  useConnections,
  useDeployments,
  useProject,
  useServices,
} from "@/lib/queries";
import { routes } from "@/lib/routes";
import { useUiStore } from "@/stores/ui-store";

import { useElementSize } from "../hooks/use-element-size";
import { CanvasScene } from "./canvas-scene";
import { CanvasSkeleton, WorkspaceFrame } from "./workspace-chrome";

/** Frame + skeleton: route-level Suspense fallback and loading state. */
export function WorkspaceSkeleton() {
  return (
    <WorkspaceFrame dots busy>
      <CanvasSkeleton />
    </WorkspaceFrame>
  );
}

/** Full-bleed canvas of one project: service cards, connections, zoom/pan. */
export function WorkspaceView({ projectId }: { projectId: string }) {
  const [frameRef, size] = useElementSize<HTMLDivElement>();
  const project = useProject(projectId);
  const services = useServices({ projectId });
  const connections = useConnections(projectId);
  const deployments = useDeployments({ projectId });

  const projectData = project.data;
  useEffect(() => {
    if (projectData) useUiStore.getState().setLastProjectId(projectData.id);
  }, [projectData]);

  const notFound = project.isError && isApiError(project.error) && project.error.code === "not_found";
  const failed = !notFound && (project.isError || services.isError);
  const ready = projectData !== undefined && services.data !== undefined && size !== null;

  return (
    <WorkspaceFrame ref={frameRef} dots={!ready} busy={!ready && !notFound && !failed}>
      {notFound ? (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <EmptyState
            icon={Compass}
            title="Projet introuvable"
            description="Ce projet n’existe pas ou a été supprimé."
            action={
              <Button asChild>
                <Link href={routes.projects()}>Voir les projets</Link>
              </Button>
            }
          />
        </div>
      ) : failed ? (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <ErrorState
            title="Impossible de charger le workspace"
            error={project.error ?? services.error}
            onRetry={() => {
              void project.refetch();
              void services.refetch();
            }}
          />
        </div>
      ) : ready ? (
        <CanvasScene
          key={projectId}
          project={projectData}
          services={services.data}
          connections={connections.data ?? []}
          deployments={deployments.data ?? []}
          size={size}
          isFetching={services.isFetching}
        />
      ) : (
        <CanvasSkeleton />
      )}
    </WorkspaceFrame>
  );
}
