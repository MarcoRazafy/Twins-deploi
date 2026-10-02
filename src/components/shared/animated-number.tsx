"use client";

import { useEffect } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
} from "motion/react";

import { useHydrated } from "@/hooks/use-hydrated";
import { formatNumber } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface AnimatedNumberProps {
  value: number;
  /** Formats every frame (default: fr-FR number). */
  format?: (value: number) => string;
  className?: string;
  /** Count up from zero when the number first appears (default true). */
  animateOnMount?: boolean;
}

/** Decimals worth showing mid-animation: those of the target, at most two. */
function fractionDigits(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const fraction = String(value).split(".")[1] ?? "";
  return Math.min(fraction.length, 2);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * A number that glides to its new value (KPI cards, counters). Digits are
 * tabular so the width stays put while it moves. With reduced motion the
 * value is simply replaced.
 */
export function AnimatedNumber({
  value,
  format = formatNumber,
  className,
  animateOnMount = true,
}: AnimatedNumberProps) {
  const reducedMotion = useReducedMotionConfig();
  const hydrated = useHydrated();
  // Server HTML carries the real value; the count-up is for client mounts.
  const current = useMotionValue(animateOnMount && hydrated ? 0 : value);
  const digits = fractionDigits(value);
  const text = useTransform(current, (latest) => format(roundTo(latest, digits)));

  useEffect(() => {
    if (reducedMotion) {
      current.jump(value);
      return;
    }
    const controls = animate(current, value, {
      duration: DURATION.slow,
      ease: EASE.out,
    });
    return () => controls.stop();
  }, [current, value, reducedMotion]);

  return <motion.span className={cn("tabular", className)}>{text}</motion.span>;
}
