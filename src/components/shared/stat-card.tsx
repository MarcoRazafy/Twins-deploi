"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { motion } from "motion/react";

import { AnimatedNumber } from "@/components/shared/animated-number";
import { renderIcon, type IconProp } from "@/components/shared/render-icon";
import { Sparkline } from "@/components/shared/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPercent } from "@/lib/format";
import { hoverLift } from "@/lib/motion";
import type { StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

export type StatTone = StatusTone | "brand";

const ICON_TILES: Record<StatTone, string> = {
  neutral: "bg-secondary text-muted-foreground",
  brand: "bg-brand-600/15 text-brand-400",
  success: "bg-success/10 text-success",
  info: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

export interface StatTrend {
  /** Signed change in percent: `12` renders "12 %" with an up arrow. */
  value: number;
  /** What it is compared to: "vs hier", "sur 7 j". */
  label?: string;
  /** Set when a decrease is the good direction (latency, failures…). */
  invert?: boolean;
}

export interface StatCardProps {
  /** Sentence case, no trailing colon. */
  label: string;
  /** Numbers animate to their new value; strings are shown as given. */
  value: number | string;
  /** Formatter for numeric values (default: fr-FR number). */
  format?: (value: number) => string;
  /** Secondary line under the value. */
  hint?: ReactNode;
  icon?: IconProp;
  /** Colours the icon tile and the sparkline (default "neutral"). */
  tone?: StatTone;
  trend?: StatTrend;
  /** Recent values, oldest first. */
  sparkline?: number[];
  /** Shows skeletons of the same size as the content. */
  loading?: boolean;
  /** Makes the whole card a link. */
  href?: string;
  className?: string;
}

function Trend({ trend }: { trend: StatTrend }) {
  const direction = trend.value > 0 ? "up" : trend.value < 0 ? "down" : "flat";
  const good = direction === "flat" ? null : (direction === "up") !== Boolean(trend.invert);
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const magnitude = Math.abs(trend.value);

  return (
    <>
      <span
        className={cn(
          "tabular inline-flex shrink-0 items-center gap-0.5 font-medium",
          good === null
            ? "text-muted-foreground"
            : good
              ? "text-success"
              : "text-destructive",
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" />
        <span className="sr-only">
          {direction === "up" ? "En hausse de" : direction === "down" ? "En baisse de" : "Stable :"}
        </span>
        {formatPercent(magnitude, Number.isInteger(magnitude) ? 0 : 1)}
      </span>
      {trend.label ? <span className="truncate">{trend.label}</span> : null}
    </>
  );
}

/**
 * KPI tile: label, value, and optionally a trend, a hint and a sparkline.
 * The loading state keeps the exact geometry of the loaded one.
 */
/** Decorative icon tiles are turned off: labels carry the meaning on their own. */
const SHOW_DECORATIVE_ICONS: boolean = false;

export function StatCard({
  label,
  value,
  format,
  hint,
  icon,
  tone = "neutral",
  trend,
  sparkline,
  loading = false,
  href,
  className,
}: StatCardProps) {
  const card = cn(
    "surface-highlight flex h-full flex-col rounded-xl border bg-card p-4 sm:p-5",
    href && "transition-colors group-hover/stat:border-border-strong group-hover/stat:bg-secondary/40",
    !href && className,
  );

  const content = (
    <>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        {SHOW_DECORATIVE_ICONS && icon ? (
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              ICON_TILES[tone],
            )}
          >
            {renderIcon(icon, "size-4")}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="tabular flex h-8 items-center text-2xl font-semibold tracking-tight">
            {loading ? (
              <Skeleton className="h-7 w-24" />
            ) : typeof value === "number" ? (
              <AnimatedNumber value={value} format={format} />
            ) : (
              <span className="truncate" title={value}>
                {value}
              </span>
            )}
          </div>
          <div className="mt-1 flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
            {loading ? (
              <Skeleton className="h-3.5 w-32 max-w-full" />
            ) : (
              <>
                {trend ? <Trend trend={trend} /> : null}
                {hint ? <span className="truncate">{hint}</span> : null}
              </>
            )}
          </div>
        </div>

        {sparkline ? (
          loading ? (
            <Skeleton className="h-9 w-24 shrink-0" />
          ) : (
            <Sparkline data={sparkline} tone={tone === "neutral" ? "brand" : tone} className="h-9 w-24" />
          )
        ) : null}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-busy={loading || undefined}
        className={cn(
          "group/stat block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <motion.div {...hoverLift} className={card}>
          {content}
        </motion.div>
      </Link>
    );
  }

  return (
    <div aria-busy={loading || undefined} className={card}>
      {content}
    </div>
  );
}
