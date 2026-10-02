"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Info, RefreshCw } from "lucide-react";

import { ErrorState } from "@/components/shared/error-state";
import { MetricChart, SERIES_COLORS, type MetricSeries } from "@/components/shared/metric-chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatDuration,
  formatKilobytes,
  formatMegabytes,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { useService, useServiceMetrics } from "@/lib/queries";
import { METRIC_RANGE_LABELS } from "@/lib/constants";
import { METRIC_RANGES, type MetricRange } from "@/lib/types";
import { cn } from "@/lib/utils";

import { statsOf, type SeriesStats } from "../lib/metric-stats";
import { Segmented } from "./segmented";

const RANGE_OPTIONS = METRIC_RANGES.map((value) => ({
  value,
  label: METRIC_RANGE_LABELS[value],
}));

interface StatRow {
  label?: string;
  color?: string;
  stats: SeriesStats | null;
  format: (value: number) => string;
}

function StatFigures({ row, loading }: { row: StatRow; loading: boolean }) {
  const cells: Array<[string, number | undefined]> = [
    ["Actuel", row.stats?.current],
    ["Moyenne", row.stats?.average],
    ["Pic", row.stats?.peak],
  ];

  return (
    <div className="flex items-end gap-4 @sm:gap-6">
      {row.label ? (
        <span className="flex w-16 shrink-0 items-center gap-1.5 pb-0.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: row.color }}
          />
          {row.label}
        </span>
      ) : null}
      {cells.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-14" />
          ) : (
            <p
              className={cn(
                "tabular truncate font-semibold",
                label === "Actuel" ? "text-lg" : "text-lg text-muted-foreground",
              )}
            >
              {value === undefined ? "—" : row.format(value)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

interface MetricCardProps {
  title: string;
  description: string;
  rows: StatRow[];
  loading: boolean;
  /** Extra figure on the right of the title (the p95 response time). */
  aside?: ReactNode;
  children: ReactNode;
}

function MetricCard({ title, description, rows, loading, aside, children }: MetricCardProps) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4" aria-label={title}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {aside}
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <StatFigures key={row.label ?? "main"} row={row} loading={loading} />
        ))}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const formatRate = (kb: number) => `${formatKilobytes(kb)}/s`;
const formatRequests = (value: number) => `${formatNumber(value, { maximumFractionDigits: 0 })}/min`;

/** CPU / memory / network / requests charts with a range selector. */
export function ServiceMetricsPanel({ serviceId }: { serviceId: string }) {
  const [range, setRange] = useState<MetricRange>("1h");
  const service = useService(serviceId);
  const metrics = useServiceMetrics(serviceId, range);
  const data = metrics.data;

  const series = useMemo(() => {
    if (!data) return null;
    const make = (key: string, label: string, color: string, points: typeof data.cpu): MetricSeries => ({
      key,
      label,
      color,
      data: points,
    });
    return {
      cpu: [make("cpu", "CPU", SERIES_COLORS[0], data.cpu)],
      memory: [make("memory", "Mémoire", SERIES_COLORS[2], data.memory)],
      network: [
        make("in", "Entrant", SERIES_COLORS[1], data.networkIn),
        make("out", "Sortant", SERIES_COLORS[2], data.networkOut),
      ],
      requests: [make("requests", "Requêtes", SERIES_COLORS[3], data.requests)],
    };
  }, [data]);

  if (metrics.isError && !data) {
    return (
      <ErrorState
        compact
        title="Impossible de charger les métriques"
        error={metrics.error}
        onRetry={() => void metrics.refetch()}
      />
    );
  }

  const loading = !data || !series;
  const status = service.data?.status;
  const idle = status === "stopped" || status === "crashed";
  const p95 = statsOf(data?.responseTime);

  return (
    <div className="@container space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Période des métriques"
          value={range}
          onValueChange={setRange}
          options={RANGE_OPTIONS}
          className="w-full @sm:w-56"
        />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          <RefreshCw
            aria-hidden="true"
            className={cn("size-3", metrics.isFetching && "animate-spin")}
          />
          Mise à jour automatique
        </p>
      </div>

      {idle ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border bg-secondary/40 px-3 py-2.5 text-sm text-muted-foreground"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            {status === "stopped"
              ? "Ce service est arrêté : les courbes restent à plat tant qu’il n’est pas redémarré."
              : "Ce service est en erreur : les courbes restent à plat tant qu’il n’est pas redémarré."}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 @2xl:grid-cols-2">
        <MetricCard
          title="CPU"
          description={
            data ? `Part de la limite de ${formatNumber(data.limits.cpu)} vCPU` : "Part de la limite"
          }
          loading={loading}
          rows={[{ stats: statsOf(data?.cpu), format: (value) => formatPercent(value, 1) }]}
        >
          <MetricChart
            series={series?.cpu ?? []}
            range={range}
            unit="%"
            valueFormatter={(value) => formatPercent(value, 1)}
            max={100}
            height={200}
            loading={loading}
            label="Utilisation du processeur"
            syncId="service-metrics"
          />
        </MetricCard>

        <MetricCard
          title="Mémoire"
          description={
            data ? `Limite de ${formatMegabytes(data.limits.memoryMb)}` : "Utilisation en Mo"
          }
          loading={loading}
          rows={[{ stats: statsOf(data?.memory), format: formatMegabytes }]}
        >
          <MetricChart
            series={series?.memory ?? []}
            range={range}
            valueFormatter={formatMegabytes}
            max={data?.limits.memoryMb}
            height={200}
            loading={loading}
            label="Utilisation de la mémoire"
            syncId="service-metrics"
          />
        </MetricCard>

        <MetricCard
          title="Réseau"
          description="Trafic entrant et sortant"
          loading={loading}
          rows={[
            { label: "Entrant", color: SERIES_COLORS[1], stats: statsOf(data?.networkIn), format: formatRate },
            { label: "Sortant", color: SERIES_COLORS[2], stats: statsOf(data?.networkOut), format: formatRate },
          ]}
        >
          <MetricChart
            series={series?.network ?? []}
            range={range}
            valueFormatter={formatRate}
            height={200}
            loading={loading}
            label="Trafic réseau"
            syncId="service-metrics"
          />
        </MetricCard>

        <MetricCard
          title="Requêtes par minute"
          description="Volume de requêtes traitées"
          loading={loading}
          rows={[{ stats: statsOf(data?.requests), format: formatRequests }]}
          aside={
            <div className="shrink-0 text-right">
              <p className="text-xs text-muted-foreground">Temps de réponse p95</p>
              {loading ? (
                <Skeleton className="mt-1 ml-auto h-6 w-14" />
              ) : (
                <p className="tabular text-lg font-semibold">
                  {p95 ? formatDuration(Math.round(p95.current)) : "—"}
                </p>
              )}
            </div>
          }
        >
          <MetricChart
            series={series?.requests ?? []}
            range={range}
            valueFormatter={formatRequests}
            height={200}
            loading={loading}
            label="Requêtes par minute"
            syncId="service-metrics"
          />
        </MetricCard>
      </div>
    </div>
  );
}
