"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { motion } from "motion/react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DURATION, EASE } from "@/lib/motion";
import { routes } from "@/lib/routes";
import type { Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { ImageSelection } from "../lib/image-reference";
import { ImageConfigureStep } from "./image-configure-step";
import { ImagePickerStep } from "./image-picker-step";

export interface DeployImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  onDeployed?: (service: Service) => void;
}

/** Image search/selection flow that creates a Docker service. */
export function DeployImageDialog({
  open,
  onOpenChange,
  defaultProjectId,
  onDeployed,
}: DeployImageDialogProps) {
  const router = useRouter();

  function handleDeployed(service: Service) {
    onOpenChange(false);
    if (onDeployed) onDeployed(service);
    else router.push(routes.workspace(service.projectId, { service: service.id }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        {/* Radix unmounts the content when closed: the flow starts over on each opening. */}
        <DeployFlow defaultProjectId={defaultProjectId} onDeployed={handleDeployed} />
      </DialogContent>
    </Dialog>
  );
}

const STEPS = ["Choisir une image", "Configurer"] as const;

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <ol aria-label="Étapes" className="flex items-center gap-2 text-sm">
      {STEPS.map((label, index) => {
        const number = index + 1;
        const done = step > number;
        const current = step === number;
        return (
          <li
            key={label}
            className="flex items-center gap-2"
            aria-current={current ? "step" : undefined}
          >
            {index > 0 ? <span aria-hidden className="h-px w-6 bg-border-strong sm:w-10" /> : null}
            <span
              className={cn(
                "tabular flex size-6 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                current && "border-brand-800 bg-brand-600/15 text-brand-400",
                done && "border-success/25 bg-success/10 text-success",
                !current && !done && "text-muted-foreground",
              )}
            >
              {done ? <Check aria-hidden className="size-3.5" /> : number}
            </span>
            <span className={cn(current ? "font-medium" : "text-muted-foreground")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DeployFlow({
  defaultProjectId,
  onDeployed,
}: {
  defaultProjectId: string | undefined;
  onDeployed: (service: Service) => void;
}) {
  const [selection, setSelection] = useState<ImageSelection | null>(null);
  const step = selection ? 2 : 1;

  return (
    <div className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>Déployer une image</DialogTitle>
        <DialogDescription>
          Choisissez une image Docker, puis configurez le service qui sera créé.
        </DialogDescription>
      </DialogHeader>
      <StepIndicator step={step} />
      <motion.div
        key={step}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
      >
        {selection ? (
          <ImageConfigureStep
            key={`${selection.image}:${selection.tag}`}
            selection={selection}
            defaultProjectId={defaultProjectId}
            onBack={() => setSelection(null)}
            onDeployed={onDeployed}
          />
        ) : (
          <ImagePickerStep onSelect={setSelection} />
        )}
      </motion.div>
    </div>
  );
}
