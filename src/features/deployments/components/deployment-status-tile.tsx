"use client";

import { AnimatePresence, motion } from "motion/react";

import { DURATION, EASE } from "@/lib/motion";
import { DEPLOYMENT_STATUS, TONE_CLASSES } from "@/lib/status";
import type { DeploymentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { tile: "size-7 rounded-md", icon: "size-3.5" },
  md: { tile: "size-9 rounded-lg", icon: "size-[18px]" },
  lg: { tile: "size-11 rounded-xl", icon: "size-5" },
} as const;

export interface DeploymentStatusTileProps {
  status: DeploymentStatus;
  size?: keyof typeof SIZES;
  className?: string;
}

/** Status icon on a tinted tile. The icon swaps with a pop when the status changes. */
export function DeploymentStatusTile({ status, size = "md", className }: DeploymentStatusTileProps) {
  const meta = DEPLOYMENT_STATUS[status];
  const tone = TONE_CLASSES[meta.tone];
  const Icon = meta.icon;
  const sizes = SIZES[size];

  return (
    <span
      role="img"
      aria-label={meta.label}
      title={meta.label}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center border transition-colors",
        sizes.tile,
        tone.bg,
        tone.text,
        tone.border,
        className,
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={status}
          className="inline-flex"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: DURATION.base, ease: EASE.out } }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: DURATION.fast } }}
        >
          <Icon aria-hidden="true" className={cn(sizes.icon, meta.pulse && "animate-pulse")} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
