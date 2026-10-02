"use client";

import { FolderPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { useUiStore } from "@/stores/ui-store";

import { CanvasSkeleton, WorkspaceFrame } from "./workspace-chrome";

/** `/workspace`: sends the user to the last opened project (or the first one). */
export function WorkspaceIndexView() {
  const router = useRouter();
  const projects = useProjects();
  const lastProjectId = useUiStore((state) => state.lastProjectId);

  const list = projects.data;
  const targetId = list
    ? (list.find((project) => project.id === lastProjectId)?.id ?? list[0]?.id ?? null)
    : null;

  useEffect(() => {
    if (targetId) router.replace(routes.workspace(targetId));
  }, [router, targetId]);

  if (projects.isError) {
    return (
      <WorkspaceFrame>
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <ErrorState
            title="Impossible de charger les projets"
            error={projects.error}
            onRetry={() => void projects.refetch()}
          />
        </div>
      </WorkspaceFrame>
    );
  }

  if (list && list.length === 0) {
    return (
      <WorkspaceFrame dots>
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <EmptyState
            icon={FolderPlus}
            title="Aucun projet"
            description="Créez un projet pour organiser vos services sur le canvas."
            action={
              <Button asChild>
                <Link href={routes.projects({ new: true })}>Créer un projet</Link>
              </Button>
            }
          />
        </div>
      </WorkspaceFrame>
    );
  }

  return (
    <WorkspaceFrame dots busy>
      <CanvasSkeleton />
    </WorkspaceFrame>
  );
}
