"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  MetricChart,
  SERIES_COLORS,
  type MetricSeries,
} from "@/components/shared/metric-chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { METRIC_RANGE_LABELS } from "@/lib/constants";
import { formatMegabytes } from "@/lib/format";
import { METRIC_RANGES, type MetricRange } from "@/lib/types";

import { KitExample, KitSection } from "./kit-section";
import { sampleMetric } from "./sample-data";

const NO_SERIES: MetricSeries[] = [];

interface ChartCardProps {
  title: string;
  value: string;
  hint: string;
  children: ReactNode;
}

function ChartCard({ title, value, hint, children }: ChartCardProps) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="tabular text-xl font-semibold">{value}</p>
        </div>
        <p className="truncate text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

interface ChartsSectionProps {
  loading: boolean;
}

export function ChartsSection({ loading }: ChartsSectionProps) {
  // `selected` follows the control at once; `range` (the data) follows after
  // a simulated refetch, during which the charts keep their previous render.
  const [selected, setSelected] = useState<MetricRange>("24h");
  const [range, setRange] = useState<MetricRange>("24h");
  const timer = useRef<number | null>(null);
  const refreshing = selected !== range;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function changeRange(next: MetricRange) {
    setSelected(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setRange(next), 600);
  }

  const cpu = useMemo<MetricSeries[]>(
    () => [
      {
        key: "cpu",
        label: "Processeur",
        color: SERIES_COLORS[0],
        data: sampleMetric({ seed: 3, range, base: 38, amplitude: 24, min: 2, max: 100 }),
      },
    ],
    [range],
  );

  const memory = useMemo<MetricSeries[]>(
    () => [
      {
        key: "memory",
        label: "Mémoire",
        color: SERIES_COLORS[2],
        data: sampleMetric({ seed: 8, range, base: 310, amplitude: 70, min: 120, max: 512 }),
      },
    ],
    [range],
  );

  const network = useMemo<MetricSeries[]>(
    () => [
      {
        key: "in",
        label: "Entrant",
        color: SERIES_COLORS[0],
        data: sampleMetric({ seed: 14, range, base: 420, amplitude: 260, min: 20 }),
      },
      {
        key: "out",
        label: "Sortant",
        color: SERIES_COLORS[1],
        data: sampleMetric({ seed: 21, range, base: 180, amplitude: 120, min: 10 }),
      },
    ],
    [range],
  );

  const requests = useMemo<MetricSeries[]>(
    () => [
      {
        key: "web",
        label: "cancham-web",
        color: SERIES_COLORS[0],
        data: sampleMetric({ seed: 5, range, base: 640, amplitude: 300, min: 60 }),
      },
      {
        key: "api",
        label: "api-gateway",
        color: SERIES_COLORS[1],
        data: sampleMetric({ seed: 9, range, base: 380, amplitude: 180, min: 40 }),
      },
      {
        key: "worker",
        label: "worker-emails",
        color: SERIES_COLORS[2],
        data: sampleMetric({ seed: 12, range, base: 120, amplitude: 80, min: 5 }),
      },
    ],
    [range],
  );

  return (
    <KitSection
      id="graphiques"
      title="Graphiques"
      description="MetricChart trace les métriques dans le temps : un seul axe vertical, un réticule qui liste toutes les séries, une légende dès deux séries. Les filtres vivent au-dessus des graphiques qu’ils pilotent."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={selected}
          aria-label="Période"
          onValueChange={(next: string) => {
            if (next) changeRange(next as MetricRange);
          }}
        >
          {METRIC_RANGES.map((option) => (
            <ToggleGroupItem
              key={option}
              value={option}
              className="text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground"
            >
              {METRIC_RANGE_LABELS[option]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          Changer de période garde le tracé précédent, atténué, pendant le rechargement.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Processeur" value="38 %" hint="Limite : 1 vCPU">
          <MetricChart
            series={loading ? NO_SERIES : cpu}
            range={range}
            unit="%"
            max={100}
            height={200}
            loading={loading || refreshing}
            label="Utilisation du processeur"
            syncId="kit-metrics"
          />
        </ChartCard>
        <ChartCard title="Mémoire" value="310 Mo" hint="Limite : 512 Mo">
          <MetricChart
            series={loading ? NO_SERIES : memory}
            range={range}
            valueFormatter={formatMegabytes}
            max={512}
            height={200}
            loading={loading || refreshing}
            label="Utilisation de la mémoire"
            syncId="kit-metrics"
          />
        </ChartCard>
        <ChartCard title="Réseau" value="420 Ko/s" hint="Deux séries : légende affichée">
          <MetricChart
            series={loading ? NO_SERIES : network}
            range={range}
            unit="Ko/s"
            height={224}
            loading={loading || refreshing}
            label="Trafic réseau entrant et sortant"
            syncId="kit-metrics"
          />
        </ChartCard>
        <ChartCard title="Requêtes par minute" value="1 140" hint="Séries empilées">
          <MetricChart
            series={loading ? NO_SERIES : requests}
            range={range}
            stacked
            height={224}
            loading={loading || refreshing}
            label="Requêtes par minute et par service"
            syncId="kit-metrics"
          />
        </ChartCard>
      </div>

      <KitExample title="Aucune donnée" code="emptyMessage">
        <MetricChart
          series={NO_SERIES}
          height={140}
          emptyMessage="Le service n’a pas encore émis de métriques"
          label="Graphique sans données"
        />
      </KitExample>
    </KitSection>
  );
}
