"use client";

import { useMemo, type ReactNode } from "react";
import { FolderKanban, Plus } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Stagger, StaggerItem } from "@/components/shared/motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCard } from "@/features/projects";
import { useProjects } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { ProjectSummary } from "@/lib/types";

import { DashboardSection, SectionLink } from "./dashboard-section";

const VISIBLE_PROJECTS = 6;
const GRID = "grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3";

/** Last time something happened in the project: an update or a deployment. */
function lastActivityOf(project: ProjectSummary): number {
  const updated = Date.parse(project.updatedAt);
  const deployed = project.lastDeployment ? Date.parse(project.lastDeployment.createdAt) : 0;
  return Math.max(updated, deployed);
}

function pickRecentProjects(projects: readonly ProjectSummary[]): ProjectSummary[] {
  return [...projects]
    .sort((a, b) => lastActivityOf(b) - lastActivityOf(a))
    .slice(0, VISIBLE_PROJECTS);
}

/** Same structure and heights as `ProjectCard`, so the cards replace it without a jump. */
function ProjectCardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="min-h-10 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="space-y-2.5">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-28" />
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  );
}

export interface ProjectsSectionProps {
  onCreateProject: () => void;
}

/** The six most recently active projects, as the cards of the Projets page. */
export function ProjectsSection({ onCreateProject }: ProjectsSectionProps) {
  const query = useProjects();
  const projects = query.data;
  const recent = useMemo(() => (projects ? pickRecentProjects(projects) : []), [projects]);

  let body: ReactNode;
  if (query.isError && !projects) {
    body = (
      <div className="rounded-xl border bg-card">
        <ErrorState
          compact
          title="Impossible de charger les projets"
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </div>
    );
  } else if (!projects) {
    body = (
      <div className={GRID} aria-busy="true" aria-label="Chargement des projets">
        {Array.from({ length: VISIBLE_PROJECTS }, (_, index) => (
          <ProjectCardSkeleton key={index} />
        ))}
      </div>
    );
  } else if (projects.length === 0) {
    body = (
      <EmptyState
        icon={FolderKanban}
        title="Aucun projet"
        description="Créez votre premier projet pour y déployer un service, une base PostgreSQL ou un conteneur."
        action={
          <Button type="button" variant="secondary" onClick={onCreateProject}>
            <Plus data-icon="inline-start" />
            Nouveau projet
          </Button>
        }
      />
    );
  } else {
    body = (
      <Stagger className={GRID}>
        {recent.map((project) => (
          <StaggerItem key={project.id} className="h-full">
            <ProjectCard project={project} />
          </StaggerItem>
        ))}
      </Stagger>
    );
  }

  return (
    <DashboardSection
      title="Projets"
      actions={
        projects && projects.length > 0 ? (
          <SectionLink href={routes.projects()}>Voir tous les projets</SectionLink>
        ) : null
      }
    >
      {body}
    </DashboardSection>
  );
}
