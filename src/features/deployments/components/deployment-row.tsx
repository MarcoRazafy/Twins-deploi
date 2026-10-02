"use client";

import Link from "next/link";
import { GitBranch } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { ProgressBar } from "@/components/shared/progress-bar";
import { RelativeTime } from "@/components/shared/relative-time";
import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { useHydrated } from "@/hooks/use-hydrated";
import { shortSha } from "@/lib/format";
import { DURATION, EASE, SPRING, STAGGER } from "@/lib/motion";
import { routes } from "@/lib/routes";
import { DEPLOYMENT_TRIGGER_LABELS, isDeploymentInFlight } from "@/lib/status";
import type { Deployment, Project, Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { DeploymentActions } from "../hooks/use-deployment-actions";
import { deploymentTitle } from "../lib/deployment-utils";
import { DeploymentDuration } from "./deployment-duration";
import { DeploymentRowActions } from "./deployment-row-actions";
import { DeploymentStatusTile } from "./deployment-status-tile";

function Dot() {
  return (
    <span aria-hidden="true" className="text-subtle">
      ·
    </span>
  );
}

function ProgressLine({ deployment }: { deployment: Deployment }) {
  const progress = Math.round(deployment.progress);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: DURATION.base, ease: EASE.out } }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
      className="flex items-center gap-3 pt-0.5"
    >
      <ProgressBar
        value={deployment.progress}
        tone="info"
        size="sm"
        label={`Progression du déploiement : ${progress} %`}
        className="flex-1"
      />
      <span className="tabular w-9 shrink-0 text-right text-xs font-medium text-info">
        {progress} %
      </span>
    </motion.div>
  );
}

export interface DeploymentRowProps {
  deployment: Deployment;
  service: Service | undefined;
  project: Project | undefined;
  /** Denser layout: no project, branch, trigger or inline action. */
  compact: boolean;
  /** The list is already scoped to one service: repeating its name adds nothing. */
  hideService: boolean;
  /** Position in its group, only used to stagger the entrance. */
  index: number;
  actions: DeploymentActions;
}

export function DeploymentRow({
  deployment,
  service,
  project,
  compact,
  hideService,
  index,
  actions,
}: DeploymentRowProps) {
  const hydrated = useHydrated();
  const { status, commit } = deployment;
  const inFlight = isDeploymentInFlight(status);
  const title = deploymentTitle(deployment);
  const serviceType = service?.source.type ?? (commit ? "github" : "docker");
  const triggerLabel = DEPLOYMENT_TRIGGER_LABELS[deployment.trigger];

  return (
    <motion.li
      layout="position"
      initial={hydrated ? { opacity: 0, y: -8 } : false}
      animate={{
        opacity: 1,
        y: 0,
        transition: {
          duration: DURATION.base,
          ease: EASE.out,
          delay: Math.min(index, STAGGER.maxItems) * STAGGER.step,
        },
      }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
      transition={{ layout: SPRING.smooth }}
      className={cn(
        "group/row relative transition-colors hover:bg-accent/40",
        // The deployment serving traffic stands out from the replaced ones.
        status === "active" &&
          "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-success",
      )}
    >
      <div
        className={cn(
          "flex gap-3 px-3.5 sm:px-4",
          compact ? "items-start py-2.5" : "items-start py-3 @3xl:items-center @3xl:gap-4",
        )}
      >
        <DeploymentStatusTile
          status={status}
          size={compact ? "sm" : "md"}
          className={compact ? "mt-0.5" : "mt-0.5 @3xl:mt-0"}
        />

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center">
            <Link
              href={routes.deployment(deployment.id)}
              title={title}
              className="min-w-0 truncate text-sm font-medium text-foreground outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/60 focus-visible:after:ring-inset"
            >
              {title}
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="relative inline-flex">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={status}
                  className="inline-flex"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    transition: { duration: DURATION.base, ease: EASE.out },
                  }}
                  exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
                >
                  <StatusBadge kind="deployment" status={status} size="sm" />
                </motion.span>
              </AnimatePresence>
            </span>

            {hideService && (compact || !project) ? null : (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                {hideService ? null : (
                  <>
                    <ServiceIcon type={serviceType} className="size-3.5" />
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {service?.name ?? "Service"}
                    </span>
                  </>
                )}
                {!compact && project ? (
                  <>
                    {hideService ? null : <Dot />}
                    <span className="min-w-0 truncate">{project.name}</span>
                  </>
                ) : null}
              </span>
            )}

            {commit ? (
              <span className="inline-flex items-center gap-2">
                <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {shortSha(commit.sha)}
                </code>
                {compact ? null : (
                  <Badge
                    variant="outline"
                    className="max-w-40 gap-1 px-1.5 font-mono text-[11px] font-normal text-muted-foreground"
                  >
                    <GitBranch aria-hidden="true" />
                    <span className="min-w-0 truncate">{commit.branch}</span>
                  </Badge>
                )}
              </span>
            ) : null}

            {compact ? (
              <RelativeTime date={deployment.createdAt} className="@md:hidden" />
            ) : null}
          </div>

          {compact ? null : (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground @5xl:hidden">
              <span>{triggerLabel}</span>
              <Dot />
              <span className="min-w-0 truncate">{deployment.creator}</span>
              <span className="contents @3xl:hidden">
                <Dot />
                <RelativeTime date={deployment.createdAt} />
                <Dot />
                <DeploymentDuration deployment={deployment} />
              </span>
            </p>
          )}

          <AnimatePresence initial={false}>
            {inFlight ? <ProgressLine key="progress" deployment={deployment} /> : null}
          </AnimatePresence>
        </div>

        {compact ? (
          <div className="hidden shrink-0 text-right @md:block">
            <RelativeTime
              date={deployment.createdAt}
              className="block text-xs text-muted-foreground"
            />
            <DeploymentDuration
              deployment={deployment}
              className="block text-xs text-muted-foreground"
            />
          </div>
        ) : (
          <>
            <div className="hidden w-44 shrink-0 @5xl:block">
              <p className="truncate text-sm">{triggerLabel}</p>
              <p className="truncate text-xs text-muted-foreground">{deployment.creator}</p>
            </div>
            <RelativeTime
              date={deployment.createdAt}
              className="hidden w-24 shrink-0 text-right text-sm text-muted-foreground @3xl:block"
            />
            <DeploymentDuration
              deployment={deployment}
              className="hidden w-24 shrink-0 text-right text-sm @3xl:block"
            />
          </>
        )}

        <DeploymentRowActions deployment={deployment} actions={actions} showPrimary={!compact} />
      </div>
    </motion.li>
  );
}
