"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Plus, Rocket, X } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/lib/api/contract";
import { DURATION, EASE } from "@/lib/motion";
import { useTriggerDeployment } from "@/lib/queries";
import { routes } from "@/lib/routes";

import type { VariableActions } from "../hooks/use-variable-actions";
import type { ReferenceSuggestion } from "../lib/env";

const NOTICE_MOTION = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } },
  exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE.out } },
} as const;

export interface ChangesBannerProps {
  /** null = the shared scope: there is no single service to redeploy. */
  serviceId: string | null;
  serviceName?: string;
  onDismiss: () => void;
}

/**
 * Persistent (not a toast) reminder that variable changes only reach the
 * running service with a new deployment. A service gets the button to do it.
 */
export function ChangesBanner({ serviceId, serviceName, onDismiss }: ChangesBannerProps) {
  const router = useRouter();
  const redeploy = useTriggerDeployment();

  function handleRedeploy() {
    if (!serviceId) return;
    redeploy.mutate(
      { serviceId, trigger: "config" },
      {
        onSuccess: (deployment) => {
          onDismiss();
          toast.success("Redéploiement lancé", {
            description: serviceName,
            action: {
              label: "Voir le déploiement",
              onClick: () => router.push(routes.deployment(deployment.id)),
            },
          });
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  return (
    <motion.div
      role="status"
      {...NOTICE_MOTION}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-brand-600/25 bg-brand-600/10 py-2 pr-2 pl-3"
    >
      <Rocket className="size-4 shrink-0 text-brand-400" aria-hidden="true" />
      <p className="min-w-0 flex-1 basis-56 text-sm">
        {serviceId
          ? "Les modifications seront appliquées au prochain déploiement"
          : "Les services de ce projet doivent être redéployés pour prendre en compte les variables partagées"}
      </p>
      <div className="flex items-center gap-1">
        {serviceId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={redeploy.isPending}
            onClick={handleRedeploy}
          >
            {redeploy.isPending ? <Spinner data-icon="inline-start" /> : <Rocket data-icon="inline-start" />}
            Redéployer
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Ignorer ce message"
          onClick={onDismiss}
        >
          <X />
        </Button>
      </div>
    </motion.div>
  );
}

export interface VariableSuggestionsProps {
  suggestions: readonly ReferenceSuggestion[];
  actions: VariableActions;
}

/** One-click `DATABASE_URL` references to the PostgreSQL services of the project. */
export function VariableSuggestions({ suggestions, actions }: VariableSuggestionsProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function add(suggestion: ReferenceSuggestion) {
    setPendingId(suggestion.id);
    try {
      await actions.create({ key: suggestion.key, value: suggestion.value, isSecret: true });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <motion.section aria-label="Suggestions" {...NOTICE_MOTION} className="rounded-xl border bg-card">
      <h3 className="flex items-center gap-2 px-4 pt-3 text-sm font-medium">
        <Lightbulb className="size-4 text-brand-400" aria-hidden="true" />
        Suggestions
      </h3>
      <ul className="divide-y">
        {suggestions.map((suggestion) => (
          <li key={suggestion.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1 basis-56 space-y-1">
              <p className="text-sm text-muted-foreground">
                Référencer la base <span className="font-medium text-foreground">{suggestion.databaseName}</span>
              </p>
              <code
                title={`${suggestion.key}=${suggestion.value}`}
                className="block truncate font-mono text-xs"
              >
                {suggestion.key}={suggestion.value}
              </code>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pendingId !== null}
              onClick={() => void add(suggestion)}
            >
              {pendingId === suggestion.id ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Plus data-icon="inline-start" />
              )}
              Ajouter
            </Button>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
