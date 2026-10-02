"use client";

import { useMemo } from "react";

import { ErrorState } from "@/components/shared/error-state";
import { MetricChart, SERIES_COLORS, type MetricSeries } from "@/components/shared/metric-chart";
import { ProgressBar } from "@/components/shared/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { formatGigabytes, formatMegabytes, formatPercent } from "@/lib/format";
import { usePlatformOverview } from "@/lib/queries";
import type { PlatformOverview } from "@/lib/types";

import { usageTone } from "../lib/health";
import { DashboardCard, DashboardSection } from "./dashboard-section";

const CHART_HEIGHT = 176;
const METER_COUNT = 3;

interface MeterData {
  key: string;
  label: string;
  percent: number;
  /** Exact utilisation, next to the label. */
  valueLabel: string;
  /** Absolute figures under the bar. */
  detail: string;
}

function toPercent(used: number, total: number): number {
  return total > 0 ? Math.min(100, (used / total) * 100) : 0;
}

function buildMeters({ resources, usage }: PlatformOverview): MeterData[] {
  const memoryPercent = toPercent(resources.memoryUsedMb, resources.memoryTotalMb);
  const diskPercent = toPercent(resources.diskUsedGb, resources.diskTotalGb);
  const cpuPeak = usage.cpu.reduce((peak, point) => Math.max(peak, point.v), 0);

  return [
    {
      key: "cpu",
      label: "CPU",
      percent: resources.cpuPercent,
      valueLabel: formatPercent(resources.cpuPercent, 1),
      detail: `Pic sur 24 h : ${formatPercent(cpuPeak, 1)}`,
    },
    {
      key: "memory",
      label: "Mémoire",
      percent: memoryPercent,
      valueLabel: formatPercent(memoryPercent, 1),
      detail: `${formatMegabytes(resources.memoryUsedMb)} / ${formatMegabytes(resources.memoryTotalMb)}`,
    },
    {
      key: "disk",
      label: "Disque",
      percent: diskPercent,
      valueLabel: formatPercent(diskPercent, 1),
      detail: `${formatGigabytes(resources.diskUsedGb)} / ${formatGigabytes(resources.diskTotalGb)}`,
    },
  ];
}

function ResourceMeter({ meter }: { meter: MeterData }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">{meter.label}</p>
        <p className="tabular text-sm font-medium">{meter.valueLabel}</p>
      </div>
      <ProgressBar
        value={meter.percent}
        tone={usageTone(meter.percent)}
        size="lg"
        label={`${meter.label} : ${meter.valueLabel}`}
      />
      <p className="tabular truncate text-xs text-muted-foreground">{meter.detail}</p>
    </div>
  );
}

function MeterSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex h-5 items-center justify-between gap-3">
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-3.5 w-12" />
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
      <div className="flex h-4 items-center">
        <Skeleton className="h-3 w-28" />
      </div>
    </div>
  );
}

export interface PlatformResourcesProps {
  className?: string;
}

/** Host CPU, memory and disk as meters, and the last 24 hours of CPU and memory. */
export function PlatformResources({ className }: PlatformResourcesProps) {
  const overview = usePlatformOverview();
  const data = overview.data;
  const usage = data?.usage;
  const memoryTotalMb = data?.resources.memoryTotalMb ?? 0;
  const meters = data ? buildMeters(data) : null;

  // One axis, one unit: memory (MB) is drawn as a share of the host memory so
  // it can sit next to the CPU percentage.
  const series = useMemo<MetricSeries[]>(() => {
    if (!usage || memoryTotalMb <= 0) return [];
    return [
      { key: "cpu", label: "CPU", color: SERIES_COLORS[0], data: usage.cpu },
      {
        key: "memory",
        label: "Mémoire",
        color: SERIES_COLORS[1],
        data: usage.memory.map((point) => ({
          t: point.t,
          v: Math.round(toPercent(point.v, memoryTotalMb) * 10) / 10,
        })),
      },
    ];
  }, [usage, memoryTotalMb]);

  return (
    <DashboardSection
      title="Ressources de la plateforme"
      actions={<span className="text-xs text-muted-foreground">24 dernières heures</span>}
      className={className}
    >
      <DashboardCard className="@container flex-1 p-4 sm:p-5">
        {overview.isError && !data ? (
          <div className="flex min-h-72 items-center justify-center">
            <ErrorState
              compact
              title="Impossible de charger les ressources"
              error={overview.error}
              onRetry={() => {
                void overview.refetch();
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid gap-5 @lg:grid-cols-3">
              {meters
                ? meters.map((meter) => <ResourceMeter key={meter.key} meter={meter} />)
                : Array.from({ length: METER_COUNT }, (_, index) => <MeterSkeleton key={index} />)}
            </div>
            <div className="border-t pt-5">
              <MetricChart
                series={series}
                range="24h"
                unit="%"
                max={100}
                height={CHART_HEIGHT}
                loading={!data}
                label="Utilisation du processeur et de la mémoire sur 24 heures"
              />
            </div>
          </div>
        )}
      </DashboardCard>
    </DashboardSection>
  );
}
