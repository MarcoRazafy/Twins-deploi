"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import { Timer } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { ErrorState } from "@/components/shared/error-state";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusBadge, StatusDot } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import type { DeploymentFilter } from "@/lib/api/contract";
import { EMPTY_VALUE, formatDuration } from "@/lib/format";
import { DURATION, EASE, SPRING, fadeUp, hoverLift } from "@/lib/motion";
import { useDeployments, useProjects, useServices } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { Deployment, ProjectSummary, Service } from "@/lib/types";

import { DashboardSection } from "./dashboard-section";

const IN_FLIGHT_FILTER: DeploymentFilter = { statuses: ["queued", "building", "deploying"] };

const stripMotion = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } },
  exit: { opacity: 0, y: -8, transition: { duration: DURATION.fast, ease: EASE.out } },
};

interface LiveDeploymentCardProps {
  deployment: Deployment;
  service: Service | undefined;
  project: ProjectSummary | undefined;
  /** False while the service and project lists are still loading. */
  lookupsReady: boolean;
  now: number;
}

function LiveDeploymentCard({
  deployment,
  service,
  project,
  lookupsReady,
  now,
}: LiveDeploymentCardProps) {
  const nameId = useId();
  const queued = deployment.status === "queued";
  const startedAt = Date.parse(deployment.startedAt ?? deployment.createdAt);
  const elapsed = now > 0 ? formatDuration(Math.max(0, now - startedAt)) : EMPTY_VALUE;
  const serviceName = service?.name ?? (lookupsReady ? "Service supprimé" : null);

  return (
    <motion.div
      {...hoverLift}
      className="rounded-xl border bg-card transition-colors hover:border-border-strong hover:bg-secondary/40"
    >
      <Link
        href={routes.deployment(deployment.id)}
        className="flex flex-col gap-3 rounded-xl p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {service ? (
              <ServiceIcon type={service.source.type} tile="sm" className="border" />
            ) : (
              <Skeleton className="size-7 shrink-0 rounded-md" />
            )}
            <div className="min-w-0 space-y-0.5">
              {serviceName ? (
                <p id={nameId} title={serviceName} className="truncate text-sm font-medium">
                  {serviceName}
                </p>
              ) : (
                <Skeleton className="h-5 w-28" />
              )}
              {project ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ProjectAvatar name={project.name} color={project.color} size="xs" />
                  <span className="truncate">{project.name}</span>
                </p>
              ) : (
                <Skeleton className="h-4 w-20" />
              )}
            </div>
          </div>
          <StatusBadge kind="deployment" status={deployment.status} size="sm" className="shrink-0" />
        </div>

        <ProgressBar
          value={deployment.progress}
          indeterminate={queued}
          tone="info"
          label={`Progression du déploiement de ${serviceName ?? "ce service"}`}
        />

        <div className="tabular flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{queued ? "En file d’attente" : `${Math.round(deployment.progress)} %`}</span>
          <span className="inline-flex items-center gap-1.5">
            <Timer aria-hidden="true" className="size-3.5" />
            {elapsed}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

/**
 * Live strip of the deployments that are queued, building or deploying. It
 * only exists while something is in flight: it fades in, the blocks below
 * slide down to make room (they carry `layout="position"`), and it leaves the
 * same way once everything is done.
 */
export function InFlightDeployments() {
  const query = useDeployments(IN_FLIGHT_FILTER);
  const services = useServices();
  const projects = useProjects();
  // One clock for every card: the elapsed times tick together.
  const now = useNow(1000);

  const serviceById = useMemo(
    () => new Map((services.data ?? []).map((service) => [service.id, service] as const)),
    [services.data],
  );
  const projectById = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project] as const)),
    [projects.data],
  );

  const deployments = query.data ?? [];
  const loadFailed = query.isError && !query.data;
  const lookupsReady = !services.isPending && !projects.isPending;

  return (
    <AnimatePresence initial={false}>
      {deployments.length > 0 || loadFailed ? (
        <motion.div key="in-flight" layout="position" transition={{ layout: SPRING.smooth }} {...stripMotion}>
          <DashboardSection
            title={
              <span className="inline-flex items-center gap-2">
                <StatusDot tone="info" pulse />
                Déploiements en cours
                {deployments.length > 0 ? (
                  <span className="tabular rounded-full border border-info/25 bg-info/10 px-2 text-xs font-medium text-info">
                    {deployments.length}
                  </span>
                ) : null}
              </span>
            }
          >
            {loadFailed ? (
              <div className="rounded-xl border bg-card">
                <ErrorState
                  compact
                  title="Impossible de charger les déploiements en cours"
                  error={query.error}
                  onRetry={() => {
                    void query.refetch();
                  }}
                />
              </div>
            ) : (
              <ul className="relative grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
                <AnimatePresence mode="popLayout" initial={false}>
                  {deployments.map((deployment) => (
                    <motion.li
                      key={deployment.id}
                      layout
                      variants={fadeUp}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={{ layout: SPRING.smooth }}
                    >
                      <LiveDeploymentCard
                        deployment={deployment}
                        service={serviceById.get(deployment.serviceId)}
                        project={projectById.get(deployment.projectId)}
                        lookupsReady={lookupsReady}
                        now={now}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </DashboardSection>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
