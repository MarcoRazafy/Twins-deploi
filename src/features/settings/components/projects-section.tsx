"use client";

import Link from "next/link";
import { ExternalLink, FolderKanban, Plus, Settings as SettingsIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Stagger, StaggerItem } from "@/components/shared/motion";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, pluralize } from "@/lib/format";
import { useProjects } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { ProjectSummary } from "@/lib/types";

import { QueryBoundary } from "./form-parts";

function ProjectRow({ project }: { project: ProjectSummary }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProjectAvatar name={project.name} color={project.color} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{project.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {pluralize(project.stats.services, "service")} · {pluralize(project.stats.domains, "domaine")} · créé le{" "}
            {formatDate(project.createdAt)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={routes.projectSettings(project.id)} aria-label={`Réglages du projet ${project.name}`}>
            <SettingsIcon data-icon="inline-start" />
            Réglages
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={routes.workspace(project.id)} aria-label={`Ouvrir le workspace de ${project.name}`}>
            <ExternalLink data-icon="inline-start" />
            Ouvrir le workspace
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div aria-busy className="divide-y">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="hidden h-7 w-44 sm:block" />
        </div>
      ))}
    </div>
  );
}

const NEW_PROJECT_BUTTON = (
  <Button asChild>
    <Link href={routes.projects({ new: true })}>
      <Plus data-icon="inline-start" />
      Nouveau projet
    </Link>
  </Button>
);

export function ProjectsSection() {
  const query = useProjects();

  return (
    <SectionCard
      flush
      className="overflow-hidden"
      title="Projets"
      description="Configurez chaque projet séparément : nom, région, variables et suppression."
      actions={NEW_PROJECT_BUTTON}
    >
      <div className="border-t">
        <QueryBoundary query={query} skeleton={<ProjectsSkeleton />}>
          {(projects) =>
            projects.length === 0 ? (
              <EmptyState
                compact
                icon={FolderKanban}
                title="Aucun projet"
                description="Créez votre premier projet pour déployer un service."
              />
            ) : (
              <Stagger className="divide-y">
                {projects.map((project) => (
                  <StaggerItem key={project.id}>
                    <ProjectRow project={project} />
                  </StaggerItem>
                ))}
              </Stagger>
            )
          }
        </QueryBoundary>
      </div>
    </SectionCard>
  );
}
