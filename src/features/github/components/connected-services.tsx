"use client";

import { useId, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, GitBranch } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Stagger, StaggerItem } from "@/components/shared/motion";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { RelativeTime } from "@/components/shared/relative-time";
import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeployment, useGithubBranches, useProjects } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { ProjectSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useGithubServices } from "../hooks/use-github-services";
import { useGithubSourceUpdate } from "../hooks/use-github-source-update";
import type { GithubService } from "../lib/github-services";
import { BranchSelect } from "./branch-select";

/**
 * Columns of the wide layout (header and rows share it). Narrow lists stack
 * each service as a small card instead, so no control is ever hidden.
 */
const ROW_GRID = "@3xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_12rem_7rem_11rem_2rem]";

function LastDeployment({ service }: { service: GithubService }) {
  const deployment = useDeployment(service.latestDeploymentId);

  if (service.latestDeploymentId === null) {
    return <span className="text-sm text-muted-foreground">Jamais déployé</span>;
  }
  if (deployment.isPending) return <Skeleton className="h-5 w-28" />;
  if (!deployment.data) return <span className="text-sm text-muted-foreground">Indisponible</span>;

  const latest = deployment.data;
  return (
    <Link
      href={routes.deployment(latest.id)}
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <StatusBadge kind="deployment" status={latest.status} size="sm" />
      <RelativeTime date={latest.createdAt} className="text-xs text-muted-foreground" />
    </Link>
  );
}

interface ConnectedServiceRowProps {
  service: GithubService;
  project: ProjectSummary | undefined;
  projectLoading: boolean;
}

function ConnectedServiceRow({ service, project, projectLoading }: ConnectedServiceRowProps) {
  const { source } = service;
  const branches = useGithubBranches(source.repo);
  // One saver per control: a branch change in flight must not hide the
  // auto-deploy value being saved, and the other way round.
  const branchUpdate = useGithubSourceUpdate(service.id);
  const autoDeployUpdate = useGithubSourceUpdate(service.id);

  const branch = branchUpdate.pending?.branch ?? source.branch;
  const autoDeploy = autoDeployUpdate.pending?.autoDeploy ?? source.autoDeploy;

  function changeBranch(next: string) {
    void branchUpdate.save(
      { branch: next },
      { success: `${service.name} suit désormais la branche ${next}`, offerRedeploy: true },
    );
  }

  function changeAutoDeploy(next: boolean) {
    void autoDeployUpdate.save(
      { autoDeploy: next },
      {
        success: next
          ? `Déploiement automatique activé pour ${service.name}`
          : `Déploiement automatique désactivé pour ${service.name}`,
      },
    );
  }

  const workspaceHref = routes.workspace(service.projectId, { service: service.id });

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3 transition-colors hover:bg-accent/40",
        ROW_GRID,
      )}
    >
      <div className="col-span-2 flex min-w-0 items-center gap-3 @3xl:col-span-1">
        <ServiceIcon type="github" tile="sm" />
        <div className="min-w-0">
          <Link
            href={workspaceHref}
            className="block truncate text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:underline"
          >
            {service.name}
          </Link>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {projectLoading ? (
              <Skeleton className="h-3 w-24" />
            ) : project ? (
              <>
                <ProjectAvatar name={project.name} color={project.color} size="xs" />
                <span className="truncate">{project.name}</span>
              </>
            ) : (
              "Projet introuvable"
            )}
          </p>
        </div>
      </div>

      <p
        className="col-span-2 truncate font-mono text-[13px] text-muted-foreground @3xl:col-span-1"
        title={source.repo}
      >
        {source.repo}
      </p>

      <BranchSelect
        branches={branches.data ?? []}
        value={branch}
        onChange={changeBranch}
        size="sm"
        aria-label={`Branche de ${service.name}`}
        title={
          branches.isError ? "Branches indisponibles : vérifiez la connexion GitHub." : undefined
        }
        disabled={branches.isPending || branches.isError || branchUpdate.isSaving}
      />

      <label className="flex items-center justify-end gap-2 text-xs text-muted-foreground @3xl:justify-start">
        <span className="@3xl:hidden">Déploiement auto</span>
        <Switch
          checked={autoDeploy}
          onCheckedChange={changeAutoDeploy}
          aria-label={`Déploiement automatique de ${service.name}`}
        />
      </label>

      <div className="min-w-0">
        <LastDeployment service={service} />
      </div>

      <div className="flex justify-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon-sm">
              <Link href={workspaceHref} aria-label={`Ouvrir ${service.name} dans le workspace`}>
                <ArrowUpRight />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Ouvrir dans le workspace</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function ServiceRowSkeleton() {
  return (
    <div
      aria-hidden
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3",
        ROW_GRID,
      )}
    >
      <div className="col-span-2 flex items-center gap-3 @3xl:col-span-1">
        <Skeleton className="size-7 rounded-md" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="col-span-2 h-4 w-52 max-w-full @3xl:col-span-1" />
      <Skeleton className="h-7 w-full rounded-lg" />
      <Skeleton className="h-[18px] w-8 justify-self-end rounded-full @3xl:justify-self-start" />
      <Skeleton className="h-5 w-28" />
      <Skeleton className="size-7 justify-self-end rounded-lg" />
    </div>
  );
}

export interface ConnectedServicesProps {
  onImport: () => void;
}

/** "Services connectés": every GitHub service, tuned in place. */
export function ConnectedServices({ onImport }: ConnectedServicesProps) {
  const titleId = useId();
  const { services, isPending, isError, error, refetch } = useGithubServices();
  const projects = useProjects();

  const projectsById = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project] as const)),
    [projects.data],
  );

  let body: ReactNode;
  if (isPending) {
    body = (
      <div className="divide-y">
        {Array.from({ length: 3 }, (_, index) => (
          <ServiceRowSkeleton key={index} />
        ))}
      </div>
    );
  } else if (isError) {
    body = (
      <ErrorState
        compact
        title="Impossible de charger les services"
        error={error}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  } else if (services.length === 0) {
    body = (
      <EmptyState
        compact
        icon={GitBranch}
        title="Aucun service GitHub"
        description="Importez un dépôt pour créer un service déployé à chaque push."
        action={
          <Button type="button" variant="outline" size="sm" onClick={onImport}>
            Importer un dépôt
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        <div
          className={cn(
            "hidden gap-x-4 border-b bg-secondary/40 px-4 py-2 text-xs font-medium text-muted-foreground @3xl:grid",
            ROW_GRID,
          )}
        >
          <span>Service</span>
          <span>Dépôt</span>
          <span>Branche</span>
          <span>Déploiement auto</span>
          <span>Dernier déploiement</span>
          <span className="sr-only">Actions</span>
        </div>
        <Stagger className="divide-y">
          {services.map((service) => (
            <StaggerItem key={service.id}>
              <ConnectedServiceRow
                service={service}
                project={projectsById.get(service.projectId)}
                projectLoading={projects.isPending}
              />
            </StaggerItem>
          ))}
        </Stagger>
      </>
    );
  }

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="text-base font-medium">
            Services connectés
          </h2>
          {services.length > 0 ? (
            <Badge variant="secondary" className="tabular">
              {services.length}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Les services déployés depuis GitHub, tous projets confondus.
        </p>
      </div>

      <div className="@container overflow-hidden rounded-xl border bg-card">{body}</div>
    </section>
  );
}
