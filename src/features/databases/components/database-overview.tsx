"use client";

import { useMemo, useState } from "react";
import { Archive, HardDrive, Plug, Puzzle, Rows3 } from "lucide-react";

import { ErrorState } from "@/components/shared/error-state";
import { MetricChart, SERIES_COLORS, type MetricSeries } from "@/components/shared/metric-chart";
import { ProgressBar } from "@/components/shared/progress-bar";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { useNow } from "@/hooks/use-now";
import { METRIC_RANGE_LABELS } from "@/lib/constants";
import {
  formatMegabytes,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from "@/lib/format";
import { useDatabaseBackups, useDatabaseTables, useServiceMetrics } from "@/lib/queries";
import { METRIC_RANGES, type Database, type MetricRange } from "@/lib/types";

import { storagePercent, storageTone } from "../lib/database-utils";
import { SegmentedControl } from "./segmented-control";

const RANGE_OPTIONS = METRIC_RANGES.map((range) => ({
  value: range,
  label: METRIC_RANGE_LABELS[range],
}));

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** Aperçu tab: key figures, query and resource charts, installed extensions. */
export function DatabaseOverview({ database }: { database: Database }) {
  const now = useNow(60_000);
  const [range, setRange] = useState<MetricRange>("1h");
  const tables = useDatabaseTables(database.id);
  const backups = useDatabaseBackups(database.id);
  const metrics = useServiceMetrics(database.serviceId, range);
  const percent = storagePercent(database);

  const lastBackup = useMemo(() => {
    const done = (backups.data ?? []).filter((backup) => backup.status === "completed");
    // Copy before sorting: query data is read-only.
    return [...done].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }, [backups.data]);

  const { data } = metrics;
  const querySeries = useMemo<MetricSeries[]>(
    () =>
      data ? [{ key: "queries", label: "Requêtes", color: SERIES_COLORS[0], data: data.requests }] : [],
    [data],
  );
  const resourceSeries = useMemo<MetricSeries[]>(() => {
    if (!data) return [];
    // One chart, one unit: memory is expressed as a share of its limit, like the CPU.
    const memoryLimit = data.limits.memoryMb;
    return [
      { key: "cpu", label: "CPU", color: SERIES_COLORS[0], data: data.cpu },
      {
        key: "memory",
        label: "Mémoire",
        color: SERIES_COLORS[1],
        data: data.memory.map((point) => ({
          t: point.t,
          v: memoryLimit > 0 ? (point.v / memoryLimit) * 100 : 0,
        })),
      },
    ];
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Stockage"
          value={formatMegabytes(database.storageUsedMb)}
          icon={HardDrive}
          tone={storageTone(percent)}
          hint={
            <span className="block space-y-1.5">
              <ProgressBar
                value={percent}
                tone={storageTone(percent)}
                label={`Stockage utilisé : ${formatPercent(percent, 0)}`}
              />
              <span className="block">
                sur {formatMegabytes(database.storageLimitMb)} · {formatPercent(percent, 0)}
              </span>
            </span>
          }
        />
        <StatCard
          label="Connexions actives"
          value={database.connections}
          icon={Plug}
          hint={`sur ${formatNumber(database.maxConnections)} au maximum`}
        />
        <StatCard
          label="Tables"
          value={tables.data?.length ?? 0}
          loading={tables.isPending}
          icon={Rows3}
          hint={tables.isError ? "Indisponible" : "dans le schéma public"}
        />
        <StatCard
          label="Dernière sauvegarde"
          value={
            backups.isError
              ? "Indisponible"
              : lastBackup
                ? formatRelativeTime(lastBackup.createdAt, now)
                : "Aucune"
          }
          loading={backups.isPending}
          icon={Archive}
          hint={
            lastBackup
              ? `${lastBackup.label} · ${formatMegabytes(lastBackup.sizeMb)}`
              : "Aucune pour l’instant"
          }
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium">Activité</h2>
          <SegmentedControl
            size="sm"
            label="Période des graphiques"
            value={range}
            onValueChange={setRange}
            options={RANGE_OPTIONS}
          />
        </div>

        {metrics.isError && !data ? (
          <ErrorState
            title="Impossible de charger les métriques"
            error={metrics.error}
            onRetry={() => void metrics.refetch()}
          />
        ) : (
          <div className="grid gap-4 @3xl:grid-cols-2">
            <ChartCard title="Requêtes par minute" description="Volume de requêtes traitées">
              <MetricChart
                series={querySeries}
                range={range}
                loading={metrics.isPending || metrics.isFetching}
                label="Requêtes par minute"
                height={240}
              />
            </ChartCard>
            <ChartCard
              title="CPU / Mémoire"
              description="Part de la limite du conteneur utilisée"
            >
              <MetricChart
                series={resourceSeries}
                range={range}
                unit="%"
                max={100}
                loading={metrics.isPending || metrics.isFetching}
                label="Utilisation du processeur et de la mémoire"
                height={240}
              />
            </ChartCard>
          </div>
        )}
      </div>

      <section aria-labelledby={`extensions-${database.id}`} className="space-y-3">
        <h2 id={`extensions-${database.id}`} className="flex items-center gap-2 text-base font-medium">
          <Puzzle className="size-4 text-muted-foreground" aria-hidden="true" />
          Extensions installées
        </h2>
        {database.extensions.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {database.extensions.map((extension) => (
              <li key={extension}>
                <Badge variant="secondary" className="h-6 px-2.5 font-mono">
                  {extension}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune extension installée.</p>
        )}
      </section>
    </div>
  );
}
