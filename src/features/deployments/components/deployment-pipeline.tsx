"use client";

import {
  Ban,
  Check,
  CircleCheck,
  Clock,
  Hammer,
  Rocket,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { ProgressBar } from "@/components/shared/progress-bar";
import { DURATION, EASE } from "@/lib/motion";
import { useDeploymentLogs } from "@/lib/queries";
import { DEPLOYMENT_STATUS, isDeploymentInFlight } from "@/lib/status";
import type { Deployment } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  abortedStepIndex,
  getPipelineStates,
  LAST_PIPELINE_STEP,
  PIPELINE_STEPS,
  stepCaption,
  type StepState,
} from "../lib/deployment-utils";
import { DeploymentDuration } from "./deployment-duration";

const STEP_ICONS: LucideIcon[] = [Clock, Hammer, Rocket, CircleCheck];

const STATE_STYLES: Record<StepState, { circle: string; label: string }> = {
  done: { circle: "border-success/25 bg-success/10 text-success", label: "text-foreground" },
  current: { circle: "border-info/30 bg-info/10 text-info", label: "text-foreground" },
  pending: {
    circle: "border-border bg-secondary text-muted-foreground",
    label: "text-muted-foreground",
  },
  failed: {
    circle: "border-destructive/30 bg-destructive/10 text-destructive",
    label: "text-destructive",
  },
  cancelled: {
    circle: "border-border-strong bg-secondary text-muted-foreground",
    label: "text-muted-foreground",
  },
};

function StepCircle({ state, icon }: { state: StepState; icon: LucideIcon }) {
  const StateIcon =
    state === "done" ? Check : state === "failed" ? X : state === "cancelled" ? Ban : icon;

  return (
    <span
      className={cn(
        "relative flex size-9 items-center justify-center rounded-full border transition-colors",
        STATE_STYLES[state].circle,
      )}
    >
      {state === "current" ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-pulse-ring rounded-full bg-info"
        />
      ) : null}
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={state}
          className="relative inline-flex"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: DURATION.base, ease: EASE.out } }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: DURATION.fast } }}
        >
          <StateIcon
            aria-hidden="true"
            className={cn("size-4", state === "current" && "animate-pulse")}
          />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Line from the middle of one step to the middle of the next; it fills once the step is done. */
function Connector({ filled }: { filled: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="absolute top-[17px] left-1/2 h-0.5 w-full overflow-hidden rounded-full bg-border"
    >
      <motion.span
        className="absolute inset-0 origin-left bg-success"
        initial={false}
        animate={{ scaleX: filled ? 1 : 0 }}
        transition={{ duration: DURATION.slow, ease: EASE.out }}
      />
    </span>
  );
}

export interface DeploymentPipelineProps {
  deployment: Deployment;
}

/** "File d’attente → Build → Déploiement → Actif": where the deployment is, or where it stopped. */
export function DeploymentPipeline({ deployment }: DeploymentPipelineProps) {
  const { status } = deployment;
  const inFlight = isDeploymentInFlight(status);
  const aborted = status === "failed" || status === "cancelled";
  // The stopping step is only known from the logs; the query stays off otherwise.
  const logs = useDeploymentLogs(aborted ? deployment.id : null);
  const states = getPipelineStates(status, aborted ? abortedStepIndex(logs.lines) : 0);
  const progress = Math.round(deployment.progress);

  return (
    <section
      aria-label="Pipeline de déploiement"
      className="surface-highlight rounded-xl border bg-card p-4 sm:p-5"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-medium">Pipeline</h2>
        <p className="text-sm text-muted-foreground">
          {inFlight ? "Temps écoulé" : "Durée"}{" "}
          <DeploymentDuration deployment={deployment} className="font-medium text-foreground" />
        </p>
      </div>

      <ol className="grid grid-cols-4">
        {PIPELINE_STEPS.map((step, index) => {
          const state = states[index];
          return (
            <li key={step.key} className="relative flex flex-col items-center gap-2 px-1 text-center">
              {index < LAST_PIPELINE_STEP ? <Connector filled={state === "done"} /> : null}
              <span className="relative z-10 rounded-full bg-card">
                <StepCircle state={state} icon={STEP_ICONS[index]} />
              </span>
              <span className={cn("text-xs font-medium sm:text-sm", STATE_STYLES[state].label)}>
                {step.label}
              </span>
              <span className="text-[11px] text-muted-foreground sm:text-xs">
                {stepCaption(index, state, status)}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="sr-only" aria-live="polite">
        Statut : {DEPLOYMENT_STATUS[status].label}
      </p>

      <AnimatePresence initial={false}>
        {inFlight ? (
          <motion.div
            key="progress"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: DURATION.base, ease: EASE.out } }}
            exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
            className="mt-5 space-y-2"
          >
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{DEPLOYMENT_STATUS[status].label}</span>
              <span className="tabular font-medium text-info">{progress} %</span>
            </div>
            <ProgressBar
              value={deployment.progress}
              tone="info"
              label="Progression du déploiement"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
