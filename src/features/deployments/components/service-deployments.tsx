"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Ban,
  ExternalLink,
  GitBranch,
  Globe,
  Play,
  Power,
  RotateCw,
  Rocket,
  Terminal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { ErrorState } from "@/components/shared/error-state";
import { FadeIn } from "@/components/shared/motion";
import { ProgressBar } from "@/components/shared/progress-bar";
import { RelativeTime } from "@/components/shared/relative-time";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/lib/api/contract";
import { shortSha } from "@/lib/format";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { useDeployment, useDeployments, useService, useServiceAction } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { isDeploymentInFlight, isServiceBusy, TONE_CLASSES, type StatusTone } from "@/lib/status";
import type { Deployment, Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useDeploymentActions, type DeploymentActions } from "../hooks/use-deployment-actions";
import { deploymentTitle } from "../lib/deployment-utils";
import { DeploymentDuration } from "./deployment-duration";
import { DeploymentList } from "./deployment-list";
import { DeploymentLogs } from "./deployment-logs";
import { DeploymentStatusTile } from "./deployment-status-tile";

const HISTORY_LIMIT = 10;

function CardShell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      aria-label={label}
      layout="position"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
      transition={{ layout: SPRING.smooth }}
      className={cn("rounded-xl border p-4", className)}
    >
      {children}
    </motion.section>
  );
}

/** Commit (sha, branch, author) or image reference under a card title. */
function DeploymentOrigin({ deployment }: { deployment: Deployment }) {
  const { commit, image } = deployment;
  if (commit) {
    return (
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
          {shortSha(commit.sha)}
        </code>
        <span className="inline-flex min-w-0 items-center gap-1">
          <GitBranch aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{commit.branch}</span>
        </span>
        <span className="min-w-0 truncate">{commit.author}</span>
      </p>
    );
  }
  if (image) {
    return (
      <p className="truncate font-mono text-xs text-muted-foreground" title={image}>
        {image}
      </p>
    );
  }
  return null;
}

interface CardProps {
  deployment: Deployment;
  actions: DeploymentActions;
  logsOpen: boolean;
  onToggleLogs: () => void;
}

function InFlightCard({ deployment, actions, logsOpen, onToggleLogs }: CardProps) {
  const title = deploymentTitle(deployment);
  const progress = Math.round(deployment.progress);

  return (
    <CardShell label="Déploiement en cours" className="border-info/30 bg-info/5">
      <div className="flex items-start gap-3">
        <DeploymentStatusTile status={deployment.status} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge kind="deployment" status={deployment.status} size="sm" />
            <span className="text-xs text-muted-foreground">
              Écoulé <DeploymentDuration deployment={deployment} className="text-foreground" />
            </span>
          </div>
          <p className="line-clamp-2 font-medium break-words" title={title}>
            {title}
          </p>
          <DeploymentOrigin deployment={deployment} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <ProgressBar
          value={deployment.progress}
          tone="info"
          label="Progression du déploiement"
          className="flex-1"
        />
        <span className="tabular w-9 shrink-0 text-right text-xs font-medium text-info">
          {progress} %
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="default"
          onClick={() => actions.requestCancel(deployment)}
        >
          <Ban data-icon="inline-start" />
          Annuler
        </Button>
        <Button type="button" variant="outline" size="default" aria-expanded={logsOpen} onClick={onToggleLogs}>
          <Terminal data-icon="inline-start" />
          {logsOpen ? "Masquer les logs" : "Afficher les logs"}
        </Button>
      </div>

      {logsOpen ? (
        <FadeIn className="mt-3">
          <DeploymentLogs deploymentId={deployment.id} className="h-[340px]" />
        </FadeIn>
      ) : null}
    </CardShell>
  );
}

interface ActiveCardProps extends CardProps {
  service: Service;
  onRestart: () => void;
  restarting: boolean;
}

function ActiveCard({
  deployment,
  service,
  actions,
  logsOpen,
  onToggleLogs,
  onRestart,
  restarting,
}: ActiveCardProps) {
  const title = deploymentTitle(deployment);
  // A stopped service keeps its last release, but it is not serving it any more.
  const stopped = service.status === "stopped";

  return (
    <CardShell
      label="Déploiement actif"
      className={
        stopped
          ? "border-border-strong bg-card"
          : "surface-highlight border-success/25 bg-success/5"
      }
    >
      <div className="flex items-start gap-3">
        <DeploymentStatusTile status={deployment.status} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className={cn("font-medium", stopped ? "text-muted-foreground" : "text-success")}>
              {stopped ? "Dernière version active" : "Déploiement actif"}
            </span>
            <span className="text-muted-foreground">
              <RelativeTime prefix="Déployé" date={deployment.finishedAt ?? deployment.createdAt} />
              {" · durée "}
              <DeploymentDuration deployment={deployment} className="text-foreground" />
            </span>
          </div>
          <p className="line-clamp-2 font-medium break-words" title={title}>
            {title}
          </p>
          <DeploymentOrigin deployment={deployment} />
          {service.primaryDomain ? (
            <a
              href={`https://${service.primaryDomain}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-sm text-brand-400 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Globe aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{service.primaryDomain}</span>
              <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="default"
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
        <Button type="button" variant="outline" size="default" aria-expanded={logsOpen} onClick={onToggleLogs}>
          <Terminal data-icon="inline-start" />
          {logsOpen ? "Masquer les logs" : "Voir les logs"}
        </Button>
        {stopped ? null : (
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={restarting || isServiceBusy(service.status)}
            onClick={onRestart}
          >
            {restarting ? <Spinner data-icon="inline-start" /> : <Power data-icon="inline-start" />}
            Redémarrer
          </Button>
        )}
      </div>

      {logsOpen ? (
        <FadeIn className="mt-3">
          <DeploymentLogs deploymentId={deployment.id} className="h-[340px]" />
        </FadeIn>
      ) : null}
    </CardShell>
  );
}

interface StateCalloutProps {
  tone: StatusTone;
  icon: LucideIcon;
  title: string;
  description: string;
  action: ReactNode;
}

function StateCallout({ tone, icon: Icon, title, description, action }: StateCalloutProps) {
  const classes = TONE_CLASSES[tone];
  return (
    <FadeIn>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center",
          classes.bg,
          classes.border,
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card",
              classes.text,
              classes.border,
            )}
          >
            <Icon aria-hidden="true" className="size-[18px]" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </div>
    </FadeIn>
  );
}

function ServiceDeploymentsSkeleton({ className }: { className?: string }) {
  return (
    <div aria-busy="true" className={cn("space-y-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-36 rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-52 rounded-xl" />
      </div>
    </div>
  );
}

export interface ServiceDeploymentsProps {
  serviceId: string;
  className?: string;
}

/**
 * Deployments tab of the service panel: the deployment in flight and the
 * active one up front, logs one click away, the history below.
 */
export function ServiceDeployments({ serviceId, className }: ServiceDeploymentsProps) {
  const service = useService(serviceId);
  const history = useDeployments({ serviceId, limit: HISTORY_LIMIT });
  const activeQuery = useDeployment(service.data?.activeDeploymentId);
  const actions = useDeploymentActions();
  const { mutateAsync: runServiceAction, isPending: serviceActionPending } = useServiceAction();
  // Which deployment's logs are expanded: a new deployment starts collapsed.
  const [inFlightLogsFor, setInFlightLogsFor] = useState<string | null>(null);
  const [activeLogsFor, setActiveLogsFor] = useState<string | null>(null);

  if (service.isError) {
    return (
      <ErrorState
        compact
        className={className}
        error={service.error}
        onRetry={() => {
          void service.refetch();
        }}
      />
    );
  }
  if (service.isPending || history.isPending) return <ServiceDeploymentsSkeleton className={className} />;

  const current = service.data;
  const inFlight = history.data?.find((deployment) => isDeploymentInFlight(deployment.status));
  const active = activeQuery.data?.status === "active" ? activeQuery.data : undefined;
  const neverDeployed = history.data?.length === 0 && !current.latestDeploymentId;

  const changeServiceState = async (action: "start" | "restart") => {
    try {
      await runServiceAction({ id: serviceId, action });
      toast.success(action === "start" ? "Démarrage en cours" : "Redémarrage en cours", {
        description: current.name,
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  let callout: ReactNode = null;
  if (neverDeployed) {
    callout = (
      <StateCallout
        tone="info"
        icon={Rocket}
        title="Ce service n’a pas encore été déployé"
        description="Lancez un premier déploiement pour le mettre en ligne."
        action={
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={actions.launching}
            onClick={() => {
              void actions.deploy(serviceId);
            }}
          >
            <Rocket data-icon="inline-start" />
            Déployer
          </Button>
        }
      />
    );
  } else if (current.status === "stopped") {
    callout = (
      <StateCallout
        tone="neutral"
        icon={Power}
        title="Ce service est arrêté"
        description="Il ne reçoit plus de trafic. Démarrez-le pour le remettre en ligne."
        action={
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={serviceActionPending}
            onClick={() => {
              void changeServiceState("start");
            }}
          >
            <Play data-icon="inline-start" />
            Démarrer
          </Button>
        }
      />
    );
  } else if (current.status === "crashed") {
    callout = (
      <StateCallout
        tone="danger"
        icon={TriangleAlert}
        title="Ce service est en erreur"
        description="Le processus s’est arrêté de façon inattendue. Consultez les logs, puis redéployez."
        action={
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={actions.launching}
            onClick={() => {
              void actions.redeploy({ serviceId });
            }}
          >
            <RotateCw data-icon="inline-start" />
            Redéployer
          </Button>
        }
      />
    );
  }

  return (
    <div className={cn("space-y-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-medium">Déploiements</h3>
          <p className="text-sm text-muted-foreground">
            Version en ligne, déploiement en cours et historique de ce service.
          </p>
        </div>
        <Button
          type="button"
          disabled={actions.launching}
          onClick={() => {
            void actions.deploy(serviceId, { replacesInFlight: Boolean(inFlight) });
          }}
        >
          {actions.launching ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Rocket data-icon="inline-start" />
          )}
          Déployer
        </Button>
      </div>

      {callout}

      <AnimatePresence>
        {inFlight ? (
          <InFlightCard
            key={`in-flight-${inFlight.id}`}
            deployment={inFlight}
            actions={actions}
            logsOpen={inFlightLogsFor === inFlight.id}
            onToggleLogs={() =>
              setInFlightLogsFor((open) => (open === inFlight.id ? null : inFlight.id))
            }
          />
        ) : null}
        {active ? (
          <ActiveCard
            key={`active-${active.id}`}
            deployment={active}
            service={current}
            actions={actions}
            logsOpen={activeLogsFor === active.id}
            onToggleLogs={() => setActiveLogsFor((open) => (open === active.id ? null : active.id))}
            onRestart={() => {
              void changeServiceState("restart");
            }}
            restarting={serviceActionPending}
          />
        ) : null}
      </AnimatePresence>

      {neverDeployed ? null : (
        <section aria-label="Historique des déploiements" className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-medium">Historique</h4>
            <Link
              href={routes.deployments({ service: serviceId })}
              className="rounded-sm text-sm text-brand-400 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Voir tout
            </Link>
          </div>
          <DeploymentList
            compact
            filter={{ serviceId, limit: HISTORY_LIMIT }}
            emptyHint="Aucun déploiement pour ce service."
          />
        </section>
      )}

      {actions.dialogs}
    </div>
  );
}
