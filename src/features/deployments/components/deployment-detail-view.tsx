"use client";

import { useCallback } from "react";
import Link from "next/link";
import { Ban, History, RotateCw, SearchX, TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { FadeIn } from "@/components/shared/motion";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { isApiError } from "@/lib/api/contract";
import { useDeployment, useProject, useService } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { canRollbackTo, isDeploymentInFlight } from "@/lib/status";
import type { Deployment } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useDeploymentActions } from "../hooks/use-deployment-actions";
import { deploymentTitle } from "../lib/deployment-utils";
import { DeploymentLogs } from "./deployment-logs";
import { DeploymentPipeline } from "./deployment-pipeline";
import { DeploymentSummary } from "./deployment-summary";

const FAILURE_TITLES = {
  failed: "Le déploiement a échoué",
  crashed: "Le service s’est arrêté",
  cancelled: "Le déploiement a été annulé",
} as const;

function FailureCallout({ deployment }: { deployment: Deployment }) {
  const { status, error } = deployment;
  if (!error) return null;
  if (status !== "failed" && status !== "crashed" && status !== "cancelled") return null;

  // A cancellation is a choice, not a failure: it keeps the neutral tone of its status.
  const cancelled = status === "cancelled";
  return (
    <FadeIn>
      <Alert
        variant={cancelled ? "default" : "destructive"}
        role={cancelled ? "status" : "alert"}
        className={cn(
          "px-4 py-3",
          cancelled ? "border-border-strong bg-secondary/40" : "border-destructive/30 bg-destructive/5",
        )}
      >
        {cancelled ? <Ban /> : <TriangleAlert />}
        <AlertTitle>{FAILURE_TITLES[status]}</AlertTitle>
        <AlertDescription className="break-words">{error}</AlertDescription>
      </Alert>
    </FadeIn>
  );
}

function DeploymentDetailSkeleton() {
  return (
    <PageContainer className="min-h-full">
      <div aria-busy="true" className="flex flex-col gap-4">
        <Skeleton className="h-5 w-28" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-80 max-w-full" />
            <Skeleton className="h-5 w-44" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
      </div>
      <Skeleton className="h-44 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="min-h-[420px] flex-1 rounded-xl" />
    </PageContainer>
  );
}

export interface DeploymentDetailViewProps {
  deploymentId: string;
}

/** One deployment: pipeline, summary, failure reason and live logs. */
export function DeploymentDetailView({ deploymentId }: DeploymentDetailViewProps) {
  const query = useDeployment(deploymentId);
  const deployment = query.data;
  const service = useService(deployment?.serviceId);
  const project = useProject(deployment?.projectId);
  const actions = useDeploymentActions();

  // "Voir les logs" links end with #logs, but the section only exists once the
  // data has loaded: Next.js has already tried (and missed) the anchor by then.
  const scrollToLogsAnchor = useCallback((node: HTMLElement | null) => {
    if (node && window.location.hash === "#logs") node.scrollIntoView({ block: "start" });
  }, []);

  if (query.isPending) return <DeploymentDetailSkeleton />;

  if (!deployment) {
    const notFound = isApiError(query.error) && query.error.code === "not_found";
    return (
      <PageContainer>
        {notFound ? (
          <EmptyState
            icon={SearchX}
            title="Déploiement introuvable"
            description="Ce déploiement n’existe pas ou a été supprimé avec son service."
            action={
              <Button asChild>
                <Link href={routes.deployments()}>Voir les déploiements</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        )}
      </PageContainer>
    );
  }

  const inFlight = isDeploymentInFlight(deployment.status);
  const rollbackable = canRollbackTo(deployment.status);

  return (
    <PageContainer className="min-h-full">
      <PageHeader
        backHref={routes.deployments()}
        backLabel="Déploiements"
        title={deploymentTitle(deployment)}
        badge={<StatusBadge kind="deployment" status={deployment.status} />}
        description={
          service.data && project.data ? `${service.data.name} · ${project.data.name}` : undefined
        }
        actions={
          inFlight ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => actions.requestCancel(deployment)}
            >
              <Ban data-icon="inline-start" />
              Annuler
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant={rollbackable ? "outline" : "default"}
                disabled={actions.launching}
                onClick={() => {
                  void actions.redeploy(deployment);
                }}
              >
                {actions.launching ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RotateCw data-icon="inline-start" />
                )}
                Redéployer
              </Button>
              {rollbackable ? (
                <Button type="button" onClick={() => actions.requestRollback(deployment)}>
                  <History data-icon="inline-start" />
                  Restaurer cette version
                </Button>
              ) : null}
            </>
          )
        }
      />

      <DeploymentPipeline deployment={deployment} />
      <FailureCallout deployment={deployment} />
      <DeploymentSummary
        deployment={deployment}
        service={service.data}
        project={project.data}
        loadingRefs={service.isPending || project.isPending}
      />

      <section
        ref={scrollToLogsAnchor}
        id="logs"
        className="flex min-h-[420px] flex-1 scroll-mt-6 flex-col"
      >
        <h2 className="sr-only">Logs du déploiement</h2>
        <DeploymentLogs
          deploymentId={deployment.id}
          className="h-auto min-h-[420px] flex-1"
        />
      </section>

      {actions.dialogs}
    </PageContainer>
  );
}
