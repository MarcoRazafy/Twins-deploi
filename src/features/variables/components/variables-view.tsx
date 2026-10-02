"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { FolderPlus, Plus, Share2 } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { FadeIn } from "@/components/shared/motion";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { ServiceIcon } from "@/components/shared/service-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated } from "@/hooks/use-hydrated";
import { useQueryParams } from "@/hooks/use-query-param";
import { pluralize } from "@/lib/format";
import { useProjects, useServices, useVariables } from "@/lib/queries";
import { routes } from "@/lib/routes";

import { ScopePickers, ScopeRail, type ScopeCount } from "./scope-rail";
import { VariablesEditor } from "./variables-editor";
import { VariablesSkeleton } from "./variables-table";

function SummarySkeleton() {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <Skeleton className="size-7 rounded-md" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-32" />
    </div>
  );
}

/** Left rail on desktop, selects on mobile, then the editor of the chosen scope. */
export function VariablesView() {
  const params = useQueryParams();
  // The sidebar fills the shared cache before this boundary hydrates: render the
  // loading branch until then, exactly like the server HTML, whatever the cache holds.
  const hydrated = useHydrated();
  const projects = useProjects();
  const paramProject = params.get("project");
  const paramService = params.get("service");
  const newRequested = params.get("new") === "1";

  // ?project= falls back to the first project, ?service= to the shared scope.
  const projectList = projects.data;
  const project =
    projectList?.find((item) => item.id === paramProject) ?? projectList?.[0] ?? null;
  const projectId = project?.id ?? null;

  const services = useServices(projectId ? { projectId } : undefined, {
    enabled: projectId !== null,
  });
  const projectVariables = useVariables(projectId ? { projectId } : undefined, {
    enabled: projectId !== null,
  });

  const service =
    paramService && paramService !== "shared"
      ? (services.data?.find((item) => item.id === paramService) ?? null)
      : null;
  const serviceId = service?.id ?? null;

  const counts = useMemo(() => {
    if (!projectVariables.data) return undefined;
    const result = new Map<string | null, ScopeCount>();
    for (const variable of projectVariables.data) {
      const current = result.get(variable.serviceId) ?? { total: 0, secrets: 0 };
      result.set(variable.serviceId, {
        total: current.total + 1,
        secrets: current.secrets + (variable.isSecret ? 1 : 0),
      });
    }
    return result;
  }, [projectVariables.data]);
  const scopeCount = counts?.get(serviceId) ?? { total: 0, secrets: 0 };

  const editorReady = project !== null && services.isSuccess;
  // The ?new=1 entry point is consumed once the editor has mounted with it.
  useEffect(() => {
    if (editorReady && newRequested) params.set({ new: null });
  }, [editorReady, newRequested, params]);

  function selectProject(nextProjectId: string | null) {
    if (nextProjectId) params.set({ project: nextProjectId, service: null });
  }

  function selectScope(nextServiceId: string | null) {
    if (project) params.set({ project: project.id, service: nextServiceId });
  }

  let body: ReactNode;
  if (!hydrated || projects.isPending) {
    body = (
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="hidden space-y-3 lg:block" aria-hidden="true">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <SummarySkeleton />
          <VariablesSkeleton />
        </div>
      </div>
    );
  } else if (!projectList) {
    body = (
      <ErrorState
        title="Impossible de charger les projets"
        error={projects.error}
        onRetry={() => void projects.refetch()}
      />
    );
  } else if (!project) {
    body = (
      <EmptyState
        icon={FolderPlus}
        title="Aucun projet"
        description="Créez un projet pour gérer les variables d’environnement de ses services."
        action={
          <Button asChild>
            <Link href={routes.projects({ new: true })}>
              <Plus data-icon="inline-start" />
              Créer un projet
            </Link>
          </Button>
        }
      />
    );
  } else {
    const scopeKey = `${project.id}:${serviceId ?? "shared"}`;

    body = (
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <ScopeRail
            projectId={project.id}
            serviceId={serviceId}
            services={services.data}
            counts={counts}
            onProjectChange={selectProject}
            onScopeChange={selectScope}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <ScopePickers
            className="lg:hidden"
            projectId={project.id}
            serviceId={serviceId}
            onProjectChange={selectProject}
            onScopeChange={selectScope}
          />

          {services.isPending ? (
            <>
              <SummarySkeleton />
              <VariablesSkeleton />
            </>
          ) : services.isError ? (
            <ErrorState
              title="Impossible de charger les services"
              error={services.error}
              onRetry={() => void services.refetch()}
            />
          ) : (
            <FadeIn key={scopeKey} className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-live="polite">
                {service ? (
                  <ServiceIcon type={service.source.type} tile="sm" title={service.name} />
                ) : (
                  <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-secondary text-muted-foreground">
                    <Share2 className="size-3.5" aria-hidden="true" />
                  </span>
                )}
                <h2 className="min-w-0 truncate text-base font-medium">
                  {service ? service.name : "Variables partagées"}
                </h2>
                <p className="text-sm text-muted-foreground tabular">
                  {counts
                    ? `${pluralize(scopeCount.total, "variable")} · ${pluralize(scopeCount.secrets, "secret")}`
                    : "Chargement…"}
                </p>
              </div>
              <VariablesEditor
                projectId={project.id}
                serviceId={serviceId}
                defaultFormOpen={newRequested}
              />
            </FadeIn>
          )}
        </div>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Variables"
        description="Variables d’environnement par service et variables partagées par projet."
      />
      {body}
    </PageContainer>
  );
}
