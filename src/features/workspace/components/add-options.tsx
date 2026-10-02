"use client";

import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";

import { ServiceIcon } from "@/components/shared/service-icon";
import { hoverLift } from "@/lib/motion";
import type { ServiceType } from "@/lib/types";

export const ADD_OPTIONS: ReadonlyArray<{
  kind: ServiceType;
  title: string;
  description: string;
}> = [
  {
    kind: "github",
    title: "Dépôt GitHub",
    description: "Déployez une application depuis un dépôt, à chaque push.",
  },
  {
    kind: "docker",
    title: "Image Docker",
    description: "Lancez n’importe quelle image depuis Docker Hub.",
  },
  {
    kind: "postgres",
    title: "Base de données PostgreSQL",
    description: "Une base managée, prête à être reliée à vos services.",
  },
];

/** The three ways to add a service, as large selectable rows. */
export function AddOptionList({ onChoose }: { onChoose: (kind: ServiceType) => void }) {
  return (
    <div className="grid gap-2">
      {ADD_OPTIONS.map((option) => (
        <motion.button
          key={option.kind}
          type="button"
          {...hoverLift}
          onClick={() => onChoose(option.kind)}
          className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-border-strong hover:bg-secondary/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ServiceIcon type={option.kind} tile="lg" className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{option.title}</span>
            <span className="block text-xs text-muted-foreground">{option.description}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </motion.button>
      ))}
    </div>
  );
}
