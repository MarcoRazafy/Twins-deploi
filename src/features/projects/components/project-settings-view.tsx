"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Boxes,
  ChevronRight,
  Container,
  Database,
  FolderSearch,
  Globe,
  Rocket,
  Trash2,
  Variable,
  type LucideIcon,
} from "lucide-react";

import { CopyField } from "@/components/shared/copy-field";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated } from "@/hooks/use-hydrated";
import { isApiError } from "@/lib/api/contract";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useProject } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { ProjectSummary } from "@/lib/types";

import { DeleteProjectConfirm } from "./delete-project-dialog";
import { ProjectGeneralSection } from "./project-general-section";

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <dt className="text-sm leading-none font-medium">{label}</dt>
      <dd className="text-sm text-muted-foreground">{children}</dd>
    </div>
  );
}

function InformationSection({ project }: { project: ProjectSummary }) {
  return (
    <SectionCard
      title="Informations"
      description="Identifiants et dates du projet, en lecture seule."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <CopyField label="Identifiant du projet" value={project.id} mono />
          <CopyField label="Slug" value={project.slug} mono />
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <InfoItem label="Environnement">
            <Badge variant="outline" className="capitalize">
              {project.environment}
            </Badge>
          </InfoItem>
          <InfoItem label="Création">
            <time dateTime={project.createdAt}>{formatDateTime(project.createdAt)}</time>
          </InfoItem>
          <InfoItem label="Dernière modification">
            <time dateTime={project.updatedAt}>{formatDateTime(project.updatedAt)}</time>
          </InfoItem>
        </dl>
      </div>
    </SectionCard>
  );
}

interface ResourceLink {
  key: string;
  label: string;
  count: number;
  href: string;
  icon: LucideIcon;
}

function resourceLinks(project: ProjectSummary): ResourceLink[] {
  const { stats } = project;
  return [
    { key: "services", label: "Services", count: stats.services, href: routes.workspace(project.id), icon: Boxes },
    { key: "databases", label: "Bases de données", count: stats.databases, href: routes.databases({ project: project.id }), icon: Database },
    { key: "variables", label: "Variables d’environnement", count: stats.variables, href: routes.variables({ project: project.id }), icon: Variable },
    { key: "domains", label: "Domaines", count: stats.domains, href: routes.domains({ project: project.id }), icon: Globe },
    { key: "deployments", label: "Déploiements", count: stats.deployments, href: routes.deployments({ project: project.id }), icon: Rocket },
    // One container per service: the count of services is the count of containers.
    { key: "containers", label: "Conteneurs", count: stats.services, href: routes.docker({ project: project.id }), icon: Container },
  ];
}

function ResourcesSection({ project }: { project: ProjectSummary }) {
  return (
    <SectionCard
      title="Ressources"
      description="Ce que contient le projet. Chaque ligne ouvre la page correspondante, filtrée sur ce projet."
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {resourceLinks(project).map(({ key, label, count, href, icon: Icon }) => (
          <li key={key}>
            <Link
              href={href}
              className="group flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="font-medium tabular">{formatNumber(count)}</span>
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function ProjectSettings({ project }: { project: ProjectSummary }) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Once deleted, the detail query can only fail: show the placeholder instead
  // of a flash of "not found" while the redirect completes.
  const [deleted, setDeleted] = useState(false);

  if (deleted) return <ProjectSettingsSkeleton />;

  return (
    <PageContainer size="narrow">
      <PageHeader
        backHref={routes.workspace(project.id)}
        backLabel="Retour au workspace"
        icon={<ProjectAvatar name={project.name} color={project.color} size="lg" />}
        title="Réglages du projet"
        description={`Configuration de « ${project.name} » : informations générales, ressources et suppression.`}
      />

      <ProjectGeneralSection project={project} />
      <InformationSection project={project} />
      <ResourcesSection project={project} />

      <SectionCard
        tone="danger"
        title="Zone de danger"
        description="Supprimer ce projet détruit définitivement ses services, bases de données, domaines, variables et déploiements. Cette action est irréversible."
        actions={
          <Button
            variant="destructive"
            className="max-sm:h-10"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 data-icon="inline-start" />
            Supprimer le projet
          </Button>
        }
      />

      <DeleteProjectConfirm
        project={project}
        stats={project.stats}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          setDeleted(true);
          router.replace(routes.projects());
        }}
      />
    </PageContainer>
  );
}

// Same blocks as the loaded page, at about their final heights.
function ProjectSettingsSkeleton() {
  return (
    <PageContainer size="narrow">
      <div className="flex flex-col gap-4" aria-busy="true">
        <p role="status" className="sr-only">
          Chargement des réglages…
        </p>
        <Skeleton className="h-6 w-44" />
        <div className="flex items-start gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <div className="space-y-1">
            <Skeleton className="h-8 w-60" />
            <Skeleton className="h-5 w-80 max-w-full" />
          </div>
        </div>
      </div>
      <Skeleton className="h-[37rem] rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-60 rounded-xl" />
      <Skeleton className="h-[6.75rem] rounded-xl" />
    </PageContainer>
  );
}

/** /projects/[projectId]/settings: general form, read-only information, resources, danger zone. */
export function ProjectSettingsView({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  // The server renders the loading state, so must the hydration pass: the query
  // cache may already hold the project by then.
  const hydrated = useHydrated();
  const data = hydrated ? project.data : undefined;

  // The data wins over an error: a failed background refetch keeps the page up.
  if (data) return <ProjectSettings key={data.id} project={data} />;

  if (hydrated && project.isError) {
    if (isApiError(project.error) && project.error.code === "not_found") {
      return (
        <PageContainer size="narrow">
          <EmptyState
            icon={FolderSearch}
            title="Projet introuvable"
            description="Ce projet n’existe pas ou a été supprimé."
            action={
              <Button asChild>
                <Link href={routes.projects()}>Retour aux projets</Link>
              </Button>
            }
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer size="narrow">
        <ErrorState
          title="Impossible de charger le projet"
          error={project.error}
          onRetry={() => void project.refetch()}
        />
      </PageContainer>
    );
  }

  return <ProjectSettingsSkeleton />;
}
