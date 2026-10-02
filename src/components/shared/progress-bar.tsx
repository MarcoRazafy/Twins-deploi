"use client";

import { motion } from "motion/react";

import { useHydrated } from "@/hooks/use-hydrated";
import { SPRING } from "@/lib/motion";
import type { StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

export type ProgressTone = StatusTone | "brand";

// The track is a faint step of the fill colour, so the tone reads across the
// whole bar and not only on its filled part.
const TONES: Record<ProgressTone, { fill: string; track: string }> = {
  brand: { fill: "bg-primary", track: "bg-primary/15" },
  success: { fill: "bg-success", track: "bg-success/15" },
  info: { fill: "bg-info", track: "bg-info/15" },
  warning: { fill: "bg-warning", track: "bg-warning/15" },
  danger: { fill: "bg-destructive", track: "bg-destructive/15" },
  neutral: { fill: "bg-muted-foreground", track: "bg-secondary" },
};

const SIZES = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2",
} as const;

export interface ProgressBarProps {
  /** 0–100. Ignored when `indeterminate`. */
  value?: number;
  /** Unknown duration: a segment travels along the track. */
  indeterminate?: boolean;
  tone?: ProgressTone;
  size?: keyof typeof SIZES;
  className?: string;
  /** Accessible name (default "Progression"). */
  label?: string;
}

export function ProgressBar({
  value = 0,
  indeterminate = false,
  tone = "brand",
  size = "md",
  className,
  label = "Progression",
}: ProgressBarProps) {
  const hydrated = useHydrated();
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const { fill, track } = TONES[tone];

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      className={cn(
        "relative w-full overflow-hidden rounded-full",
        SIZES[size],
        track,
        className,
      )}
    >
      {indeterminate ? (
        <div
          className={cn(
            "absolute inset-0 origin-left animate-indeterminate rounded-full motion-reduce:animate-none motion-reduce:opacity-50",
            fill,
          )}
        />
      ) : (
        // Translating (rather than scaling) keeps the leading edge round.
        <motion.div
          className={cn("absolute inset-0 rounded-full", fill)}
          initial={hydrated ? { x: "-100%" } : false}
          animate={{ x: `${clamped - 100}%` }}
          transition={SPRING.smooth}
        />
      )}
    </div>
  );
}
