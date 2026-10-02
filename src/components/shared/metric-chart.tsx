"use client";

import { useId, useMemo } from "react";
import { ChartLine } from "lucide-react";
import { useReducedMotionConfig } from "motion/react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatNumber } from "@/lib/format";
import { DURATION } from "@/lib/motion";
import type { MetricPoint, MetricRange } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Series colours in the order to hand them out: 1st series, 2nd series…
 *
 * The order is not cosmetic. Violet and blue (`--chart-1` / `--chart-2`) are
 * nearly identical for red-green colour-blind readers, and so are green and
 * red, so those pairs must never be neighbours. In this order every adjacent
 * pair stays distinguishable (checked with the dataviz palette validator
 * against the card surface).
 */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export interface MetricSeries {
  /** Stable identifier of the series. */
  key: string;
  /** Name shown in the legend and the tooltip. */
  label: string;
  /** Any CSS colour, normally one of `SERIES_COLORS` or a status token. */
  color: string;
  data: MetricPoint[];
}

export interface MetricChartProps {
  /**
   * Series sharing one unit and one Y axis (never mix units: use two charts).
   * Memoise the array: a new identity re-plays the chart animation.
   */
  series: MetricSeries[];
  /** Time window of the data. Drives the format of the time axis. */
  range?: MetricRange;
  /** Appended to values: "%", "Mo", "ms"… Ignored when `valueFormatter` is set. */
  unit?: string;
  valueFormatter?: (value: number) => string;
  /** Total height in pixels, legend and time axis included (default 240). */
  height?: number;
  /**
   * Without data: shows a skeleton. With data (refetch, range change): keeps
   * the current chart, dimmed, so nothing jumps.
   */
  loading?: boolean;
  /** Upper bound of the Y axis (100 for percentages, a memory limit…). */
  max?: number;
  /** Stacks the series on top of each other (parts of a whole). */
  stacked?: boolean;
  emptyMessage?: string;
  /** Accessible name of the chart, e.g. "Utilisation du processeur". */
  label?: string;
  /** Charts sharing a `syncId` move their crosshair together. */
  syncId?: string;
  className?: string;
}

type Row = { t: number } & Record<string, number>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TICK_STEPS = [
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
];
const TARGET_TICKS = 6;
const TARGET_VALUE_TICKS = 4;
const NICE_STEPS = [1, 2, 2.5, 5, 10];
const TABLE_ROWS = 12;

const dayFormatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

function seriesId(index: number): string {
  return `s${index}`;
}

/** One row per timestamp, with a column per series (`s0`, `s1`…). */
function mergeSeries(series: MetricSeries[]): Row[] {
  const rows = new Map<number, Row>();
  series.forEach((item, index) => {
    for (const point of item.data) {
      let row = rows.get(point.t);
      if (!row) {
        row = { t: point.t } as Row;
        rows.set(point.t, row);
      }
      row[seriesId(index)] = point.v;
    }
  });
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

function startOfLocalDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Ticks on round local times (every 10 min, every 6 h, at midnight…). */
function timeTicks(min: number, max: number): { ticks: number[]; step: number } {
  const span = max - min;
  const step =
    TICK_STEPS.find((candidate) => span / candidate <= TARGET_TICKS) ??
    TICK_STEPS[TICK_STEPS.length - 1];
  if (span <= 0) return { ticks: [min], step };

  const ticks: number[] = [];
  if (step >= DAY) {
    // Walk the calendar so ticks stay on midnight across DST changes.
    const cursor = new Date(startOfLocalDay(min));
    if (cursor.getTime() < min) cursor.setDate(cursor.getDate() + 1);
    while (cursor.getTime() <= max) {
      ticks.push(cursor.getTime());
      cursor.setDate(cursor.getDate() + step / DAY);
    }
  } else {
    const origin = startOfLocalDay(min);
    for (let tick = origin + Math.ceil((min - origin) / step) * step; tick <= max; tick += step) {
      ticks.push(tick);
    }
  }
  return { ticks, step };
}

function formatClock(time: number): string {
  const date = new Date(time);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${hours < 10 ? "0" : ""}${hours}:${minutes < 10 ? "0" : ""}${minutes}`;
}

function isMidnight(time: number): boolean {
  const date = new Date(time);
  return date.getHours() === 0 && date.getMinutes() === 0;
}

/**
 * Value axis on round numbers (0 / 25 / 50 / 75 / 100, 0 / 200 / 400…).
 * With a fixed `max` the axis stops there; otherwise it ends on the first
 * tick above the data, so the top gridline is always labelled.
 */
function valueAxis(dataMax: number, max: number | undefined): { ticks: number[]; top: number } {
  const limit = max === undefined ? dataMax : Math.max(max, dataMax);
  if (!(limit > 0)) return { ticks: [0, 1], top: 1 };

  const rough = limit / TARGET_VALUE_TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    (NICE_STEPS.find((candidate) => candidate >= rough / magnitude) ?? 10) * magnitude;
  const top = max !== undefined && max >= dataMax ? max : Math.ceil(limit / step) * step;

  const ticks: number[] = [];
  for (let index = 0; index * step <= top * (1 + 1e-9); index += 1) {
    // toPrecision drops the float noise of 3 * 0.2 = 0.6000000000000001.
    ticks.push(Number((index * step).toPrecision(12)));
  }
  return { ticks, top };
}

/** Highest point the chart has to show: the tallest stack, or the largest value. */
function maxValue(rows: Row[], seriesCount: number, stacked: boolean): number {
  let highest = 0;
  for (const row of rows) {
    let total = 0;
    for (let index = 0; index < seriesCount; index += 1) {
      const value = row[seriesId(index)] ?? 0;
      if (stacked) total += value;
      else if (value > highest) highest = value;
    }
    if (stacked && total > highest) highest = total;
  }
  return highest;
}

/** At most `count` rows, evenly spread, always ending on the latest one. */
function sampleRows(rows: Row[], count: number): Row[] {
  if (rows.length <= count) return rows;
  const stride = (rows.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => rows[Math.round(index * stride)]);
}

interface MetricTooltipProps {
  row: Row | undefined;
  series: MetricSeries[];
  formatValue: (value: number) => string;
  stacked: boolean;
}

function MetricTooltip({ row, series, formatValue, stacked }: MetricTooltipProps) {
  if (!row) return null;
  const entries = series
    .map((item, index) => ({ item, value: row[seriesId(index)] }))
    .filter((entry): entry is { item: MetricSeries; value: number } => entry.value !== undefined);
  if (entries.length === 0) return null;

  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border border-border-strong bg-popover px-3 py-2 text-xs shadow-xl shadow-black/40">
      <p className="text-muted-foreground">{formatDateTime(row.t)}</p>
      {entries.map(({ item, value }) => (
        <div key={item.key} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-muted-foreground">{item.label}</span>
          <span className="tabular ml-auto pl-3 font-medium text-foreground">
            {formatValue(value)}
          </span>
        </div>
      ))}
      {stacked && entries.length > 1 ? (
        <div className="flex items-center gap-2 border-t pt-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="tabular ml-auto pl-3 font-medium text-foreground">
            {formatValue(entries.reduce((sum, entry) => sum + entry.value, 0))}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Time-series area chart for service and platform metrics.
 *
 * One Y axis, a crosshair tooltip listing every series, a legend as soon as
 * there are two series, and a screen-reader table of the same data. Arrow
 * keys move the crosshair once the chart has focus.
 */
export function MetricChart({
  series,
  range,
  unit,
  valueFormatter,
  height = 240,
  loading = false,
  max,
  stacked = false,
  emptyMessage = "Aucune donnée sur cette période",
  label,
  syncId,
  className,
}: MetricChartProps) {
  const gradientPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reducedMotion = useReducedMotionConfig();

  const rows = useMemo(() => mergeSeries(series), [series]);
  const config = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        series.map((item, index) => [
          seriesId(index),
          { label: item.label, color: item.color },
        ]),
      ),
    [series],
  );

  const formatValue =
    valueFormatter ??
    ((value: number) => (unit ? `${formatNumber(value)} ${unit}` : formatNumber(value)));

  const hasData = rows.length > 0;
  const first = hasData ? rows[0].t : 0;
  const last = hasData ? rows[rows.length - 1].t : 0;
  const { ticks, step } = timeTicks(first, last);
  const values = valueAxis(maxValue(rows, series.length, stacked), max);
  const multiDay = range === "7d" || last - first > DAY;
  const dayTicks = step >= DAY;
  const rowsByTime = new Map(rows.map((row) => [row.t, row]));
  // Overlapping areas turn muddy: only a lone or stacked series gets a full wash.
  const fillOpacity = series.length > 1 && !stacked ? 0.14 : 0.26;

  return (
    <figure
      aria-label={label}
      aria-busy={loading || undefined}
      style={{ height }}
      className={cn("flex w-full min-w-0 flex-col gap-2", className)}
    >
      {series.length > 1 ? (
        <ul className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-0.5 w-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {!hasData && loading ? (
          <Skeleton className="size-full rounded-lg" />
        ) : !hasData ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-4 text-center text-sm text-muted-foreground">
            <ChartLine aria-hidden="true" className="size-5" />
            {emptyMessage}
          </div>
        ) : (
          <ChartContainer
            config={config}
            className={cn(
              "aspect-auto size-full transition-opacity",
              loading && "opacity-50",
            )}
          >
            <AreaChart
              data={rows}
              syncId={syncId}
              accessibilityLayer
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <defs>
                {series.map((item, index) => (
                  <linearGradient
                    key={item.key}
                    id={`${gradientPrefix}-${seriesId(index)}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={`var(--color-${seriesId(index)})`}
                      stopOpacity={fillOpacity}
                    />
                    <stop
                      offset="100%"
                      stopColor={`var(--color-${seriesId(index)})`}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                ticks={ticks}
                tickFormatter={(time: number) =>
                  dayTicks || (multiDay && isMidnight(time))
                    ? dayFormatter.format(time)
                    : formatClock(time)
                }
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis
                width="auto"
                domain={[0, values.top]}
                ticks={values.ticks}
                tickFormatter={formatValue}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
                animationDuration={DURATION.fast * 1000}
                content={({ active, label: time }) =>
                  active ? (
                    <MetricTooltip
                      row={rowsByTime.get(Number(time))}
                      series={series}
                      formatValue={formatValue}
                      stacked={stacked}
                    />
                  ) : null
                }
              />
              {series.map((item, index) => (
                <Area
                  key={item.key}
                  dataKey={seriesId(index)}
                  name={item.label}
                  type="monotone"
                  stackId={stacked ? "stack" : undefined}
                  stroke={`var(--color-${seriesId(index)})`}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill={`url(#${gradientPrefix}-${seriesId(index)})`}
                  fillOpacity={1}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                  connectNulls
                  isAnimationActive={!reducedMotion}
                  animationDuration={DURATION.slow * 1000}
                  animationEasing="ease-out"
                />
              ))}
            </AreaChart>
          </ChartContainer>
        )}
      </div>

      {hasData ? (
        // The wrapper is what gets clipped: a table ignores the 1 px size of
        // `sr-only` and would widen the page.
        <div className="sr-only">
          <table>
            <caption>{label ?? "Données du graphique"}</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {series.map((item) => (
                  <th key={item.key} scope="col">
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sampleRows(rows, TABLE_ROWS).map((row) => (
                <tr key={row.t}>
                  <th scope="row">{formatDateTime(row.t)}</th>
                  {series.map((item, index) => {
                    const value = row[seriesId(index)];
                    return (
                      <td key={item.key}>{value === undefined ? "—" : formatValue(value)}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  );
}
