"use client";

import { Check, Clock, LoaderCircle, RotateCw, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { DOMAIN_STATUS, TONE_CLASSES, type StatusTone } from "@/lib/status";
import type { Domain } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useVerifyDomainAction } from "../hooks/use-domain-actions";
import {
  deriveDomainSteps,
  STEP_STATE_LABELS,
  type DomainStep,
  type StepState,
} from "../lib/domain-utils";

const STATE_TONE: Record<StepState, StatusTone> = {
  done: "success",
  active: "info",
  waiting: "warning",
  failed: "danger",
  upcoming: "neutral",
};

function StepGlyph({ state, position }: { state: StepState; position: number }) {
  switch (state) {
    case "done":
      return <Check aria-hidden="true" className="size-4" />;
    case "active":
      return <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />;
    case "waiting":
      return <Clock aria-hidden="true" className="size-4" />;
    case "failed":
      return <X aria-hidden="true" className="size-4" />;
    case "upcoming":
      return <span className="tabular text-xs font-medium">{position}</span>;
  }
}

/** Round marker of a step: swaps with a quick scale and pulses while the step runs. */
function StepMarker({ state, position }: { state: StepState; position: number }) {
  const tone = TONE_CLASSES[STATE_TONE[state]];

  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center">
      {state === "active" ? (
        <span
          aria-hidden="true"
          className={cn("absolute inset-0 animate-pulse-ring rounded-full", tone.dot)}
        />
      ) : null}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, transition: SPRING.snappy }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: DURATION.fast } }}
          className={cn(
            "relative flex size-7 items-center justify-center rounded-full border",
            tone.bg,
            tone.text,
            tone.border,
          )}
        >
          <StepGlyph state={state} position={position} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Line down to the next step, filled with the success colour once this step is done. */
function StepConnector({ filled }: { filled: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="absolute top-7 bottom-0 left-[13px] w-0.5 overflow-hidden rounded-full bg-border"
    >
      <motion.span
        initial={false}
        animate={{ scaleY: filled ? 1 : 0 }}
        transition={{ duration: DURATION.slow, ease: EASE.inOut }}
        style={{ originY: 0 }}
        className="block size-full bg-success"
      />
    </span>
  );
}

function StepDescription({ step }: { step: DomainStep }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.p
        key={step.state}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
        exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
        className="text-sm text-muted-foreground"
      >
        {step.description}
      </motion.p>
    </AnimatePresence>
  );
}

export interface DomainStepperProps {
  domain: Domain;
  className?: string;
}

/**
 * Configuration DNS → Certificat SSL → Domaine actif, following the domain
 * status live. A failure shows the backend error with a retry button.
 */
export function DomainStepper({ domain, className }: DomainStepperProps) {
  const steps = deriveDomainSteps(domain);
  const { verify, isPending } = useVerifyDomainAction();

  return (
    <div className={cn("space-y-4", className)}>
      <ol aria-label="Étapes de vérification du domaine">
        {steps.map((step, index) => (
          <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
            {index < steps.length - 1 ? <StepConnector filled={step.state === "done"} /> : null}
            <StepMarker state={step.state} position={index + 1} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <p
                  className={cn(
                    "text-sm font-medium",
                    step.state === "upcoming" && "text-muted-foreground",
                  )}
                >
                  {step.label}
                </p>
                <span
                  className={cn("text-xs font-medium", TONE_CLASSES[STATE_TONE[step.state]].text)}
                >
                  {STEP_STATE_LABELS[step.state]}
                </span>
              </div>
              <StepDescription step={step} />
            </div>
          </li>
        ))}
      </ol>

      <p role="status" className="sr-only">
        {DOMAIN_STATUS[domain.status].label}
      </p>

      <AnimatePresence initial={false}>
        {domain.status === "error" ? (
          <motion.div
            key="error"
            role="alert"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
            exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
            className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-destructive"
              />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium text-destructive">La vérification a échoué</p>
                <p className="text-sm break-words text-muted-foreground">
                  {domain.error ?? "Une erreur inattendue est survenue."}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => verify(domain)}
            >
              {isPending ? <Spinner data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />}
              Réessayer
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
