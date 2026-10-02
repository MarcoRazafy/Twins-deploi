"use client";

import { useMemo, type ReactNode } from "react";
import { Rocket } from "lucide-react";
import { useReducedMotionConfig } from "motion/react";
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatPercent, pluralize } from "@/lib/format";
import { DURATION } from "@/lib/motion";
import { usePlatformOverview } from "@/lib/queries";

import {
  buildDeploymentDays,
  summarizeDeploymentDays,
  type DeploymentDay,
  type DeploymentSeriesSummary,
} from "../lib/deployment-series";
import { DashboardCard, DashboardSection } from "./dashboard-section";

/**
 * Succeeded runs use a softened step of the success token. Next to the failure
 * red the plain green only reaches a colour-blind separation of ΔE 5 (dataviz
 * palette validator, deutan, against the card surface); this mix reaches 9
 * and keeps the green hue. The quieter fill also lets the failures stand out.
 */
const SUCCEEDED_COLOR = "color-mix(in oklab, var(--success) 85%, white)";
const FAILED_COLOR = "var(--destructive)";

const CHART_CONFIG: ChartConfig = {
  succeeded: { label: "Réussis", color: SUCCEEDED_COLOR },
  failed: { label: "Échoués", color: FAILED_COLOR },
};

const SEGMENT_GAP = 2;
const END_RADIUS = 4;
const MAX_BAR_WIDTH = 24;
const ROUNDED_TOP: [number, number, number, number] = [END_RADIUS, END_RADIUS, 0, 0];

// Bar heights of the loading placeholder, in percent of the plot.
const SKELETON_BARS = [38, 54, 46, 72, 60, 34, 82, 50, 66, 42, 76, 58, 48, 64];

// Height of the legend row + the plot: states without a chart keep it.
const BODY_MIN_HEIGHT = "min-h-64";

interface SegmentShape {
  x: number;
  y: number;
  width: number;
  height: number;
  failed: number;
}

/** Recharts hands a custom shape the geometry of the bar and its data row. */
function readSegment(props: unknown): SegmentShape | null {
  if (typeof props !== "object" || props === null) return null;
  const { x, y, width, height, payload } = props as Record<string, unknown>;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const failed = (payload as Record<string, unknown>).failed;
  if (typeof failed !== "number") return null;
  return { x, y, width, height, failed };
}

/**
 * The succeeded segment sits under the failures: it rounds its top end only
 * when it is the top of the stack, and leaves a 2 px gap of surface under the
 * failures otherwise (marks are separated by air, never by a border).
 */
function renderSucceededSegment(props: unknown) {
  const segment = readSegment(props);
  if (!segment) return <g />;

  const { x, y, width, height, failed } = segment;
  const topmost = failed === 0;
  const trim = topmost ? 0 : Math.min(SEGMENT_GAP, Math.max(height - 1, 0));

  return (
    <Rectangle
      x={x}
      y={y + trim}
      width={width}
      height={height - trim}
      fill="var(--color-succeeded)"
      radius={topmost ? ROUNDED_TOP : 0}
    />
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-[3px]"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular ml-auto pl-3 font-medium text-foreground">{formatNumber(value)}</span>
    </div>
  );
}

function DeploymentsTooltip({ day }: { day: DeploymentDay }) {
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border-strong bg-popover px-3 py-2 text-xs shadow-xl shadow-black/40">
      <p className="font-medium text-foreground first-letter:uppercase">{day.longLabel}</p>
      <TooltipRow color={SUCCEEDED_COLOR} label="Réussis" value={day.succeeded} />
      <TooltipRow color={FAILED_COLOR} label="Échoués" value={day.failed} />
      <div className="flex items-center gap-2 border-t pt-1.5">
        <span className="text-muted-foreground">Total</span>
        <span className="tabular ml-auto font-medium text-foreground">{formatNumber(day.total)}</span>
      </div>
    </div>
  );
}

function describeSummary(summary: DeploymentSeriesSummary): string {
  const peak = summary.peak
    ? ` Pic le ${summary.peak.longLabel} avec ${pluralize(summary.peak.total, "déploiement")}.`
    : "";
  return `Déploiements des 14 derniers jours : ${pluralize(summary.total, "déploiement")}, dont ${formatNumber(summary.succeeded)} réussis et ${formatNumber(summary.failed)} échoués.${peak}`;
}

interface DeploymentsChartProps {
  days: DeploymentDay[];
  summary: DeploymentSeriesSummary;
}

function DeploymentsChart({ days, summary }: DeploymentsChartProps) {
  const reducedMotion = useReducedMotionConfig();
  const daysByLabel = useMemo(() => new Map(days.map((day) => [day.label, day] as const)), [days]);
  const animation = {
    isAnimationActive: !reducedMotion,
    animationDuration: DURATION.slow * 1000,
    animationEasing: "ease-out" as const,
  };

  return (
    <figure aria-label={describeSummary(summary)} className="flex flex-col gap-3">
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <ul className="flex items-center gap-4 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{ backgroundColor: SUCCEEDED_COLOR }}
            />
            Réussis
          </li>
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{ backgroundColor: FAILED_COLOR }}
            />
            Échoués
          </li>
        </ul>
        <p className="tabular text-xs text-muted-foreground">
          {pluralize(summary.total, "déploiement")}
          {summary.successRate === null ? null : ` · ${formatPercent(summary.successRate, 0)} réussis`}
        </p>
      </div>

      <ChartContainer config={CHART_CONFIG} className="aspect-auto h-56 w-full">
        <BarChart
          data={days}
          accessibilityLayer
          margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="22%"
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={10}
            interval="preserveStartEnd"
          />
          <YAxis width={28} allowDecimals={false} tickLine={false} axisLine={false} tickMargin={4} />
          <ChartTooltip
            animationDuration={DURATION.fast * 1000}
            content={({ active, label }) => {
              if (!active) return null;
              const day = daysByLabel.get(String(label));
              return day ? <DeploymentsTooltip day={day} /> : null;
            }}
          />
          <Bar
            dataKey="succeeded"
            stackId="runs"
            maxBarSize={MAX_BAR_WIDTH}
            shape={renderSucceededSegment}
            {...animation}
          />
          <Bar
            dataKey="failed"
            stackId="runs"
            fill="var(--color-failed)"
            radius={ROUNDED_TOP}
            maxBarSize={MAX_BAR_WIDTH}
            {...animation}
          />
        </BarChart>
      </ChartContainer>

      {/* The same figures as a table, for screen readers; the wrapper is what
          gets clipped because a table ignores the 1 px size of `sr-only`. */}
      <div className="sr-only">
        <table>
          <caption>Déploiements par jour sur les 14 derniers jours</caption>
          <thead>
            <tr>
              <th scope="col">Jour</th>
              <th scope="col">Réussis</th>
              <th scope="col">Échoués</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <th scope="row">{day.longLabel}</th>
                <td>{day.succeeded}</td>
                <td>{day.failed}</td>
                <td>{day.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function ChartSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement du graphique" className="flex flex-col gap-3">
      <div className="flex min-h-5 items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-16" />
        </div>
        <Skeleton className="h-3.5 w-32" />
      </div>
      <div className="flex h-56 items-end gap-2 pb-7 pl-7">
        {SKELETON_BARS.map((height, index) => (
          <Skeleton
            key={index}
            className="flex-1 rounded-t-md rounded-b-none"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export interface DeploymentActivityChartProps {
  className?: string;
}

/** Stacked bars of the last 14 days: what succeeded and what failed, day by day. */
export function DeploymentActivityChart({ className }: DeploymentActivityChartProps) {
  const overview = usePlatformOverview();
  const perDay = overview.data?.deploymentsPerDay;
  const days = useMemo(() => (perDay ? buildDeploymentDays(perDay) : null), [perDay]);
  const summary = useMemo(() => (days ? summarizeDeploymentDays(days) : null), [days]);

  let body: ReactNode;
  if (overview.isError && !perDay) {
    body = (
      <div className={`flex items-center justify-center ${BODY_MIN_HEIGHT}`}>
        <ErrorState
          compact
          title="Impossible de charger l’activité"
          error={overview.error}
          onRetry={() => {
            void overview.refetch();
          }}
        />
      </div>
    );
  } else if (!days || !summary) {
    body = <ChartSkeleton />;
  } else if (summary.total === 0) {
    body = (
      <div className={`flex items-center justify-center ${BODY_MIN_HEIGHT}`}>
        <EmptyState
          compact
          icon={Rocket}
          title="Aucun déploiement"
          description="Aucun déploiement n’a eu lieu au cours des 14 derniers jours."
        />
      </div>
    );
  } else {
    body = <DeploymentsChart days={days} summary={summary} />;
  }

  return (
    <DashboardSection
      title="Activité des déploiements"
      actions={<span className="text-xs text-muted-foreground">14 derniers jours</span>}
      className={className}
    >
      <DashboardCard className="flex-1 p-4 sm:p-5">{body}</DashboardCard>
    </DashboardSection>
  );
}
