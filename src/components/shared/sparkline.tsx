import { useId } from "react";

import type { StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

export type SparklineTone = StatusTone | "brand";

const TONE_TEXT: Record<SparklineTone, string> = {
  brand: "text-brand-400",
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
};

// Drawing space. The SVG stretches to its box, so only ratios matter.
const WIDTH = 100;
const HEIGHT = 32;
const PADDING_Y = 4;

type Point = readonly [x: number, y: number];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Monotone cubic interpolation: smooth, and never overshoots the data. */
function monotonePath(points: readonly Point[]): string {
  const count = points.length;
  if (count === 0) return "";
  const [startX, startY] = points[0];
  if (count === 1) return `M${startX},${startY}`;

  const slopes: number[] = [];
  const widths: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const width = points[index + 1][0] - points[index][0];
    widths.push(width);
    slopes.push((points[index + 1][1] - points[index][1]) / width);
  }

  const tangents: number[] = [slopes[0]];
  for (let index = 1; index < count - 1; index += 1) {
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before * after <= 0) {
      tangents.push(0);
    } else {
      const weightBefore = 2 * widths[index] + widths[index - 1];
      const weightAfter = widths[index] + 2 * widths[index - 1];
      tangents.push(
        (weightBefore + weightAfter) / (weightBefore / before + weightAfter / after),
      );
    }
  }
  tangents.push(slopes[count - 2]);

  let path = `M${round(startX)},${round(startY)}`;
  for (let index = 0; index < count - 1; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    const third = widths[index] / 3;
    path += `C${round(x0 + third)},${round(y0 + third * tangents[index])} ${round(
      x1 - third,
    )},${round(y1 - third * tangents[index + 1])} ${round(x1)},${round(y1)}`;
  }
  return path;
}

export interface SparklineProps {
  /** Values, oldest first. Needs at least two to draw a trend. */
  data: number[];
  /** Sets the size (default `h-8 w-24`). */
  className?: string;
  tone?: SparklineTone;
  /** Accessible description. Decorative when omitted. */
  label?: string;
}

/**
 * Tiny inline trend line with a soft fill and a dot on the latest value.
 * No axes and no interaction: it gives the shape, the number next to it gives
 * the value.
 */
export function Sparkline({ data, className, tone = "brand", label }: SparklineProps) {
  const gradientId = useId();
  const values = data.filter((value) => Number.isFinite(value));

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const points: Point[] = values.map((value, index) => [
    values.length === 1 ? WIDTH : (index / (values.length - 1)) * WIDTH,
    // A flat series sits on the middle line instead of the floor.
    span === 0
      ? HEIGHT / 2
      : HEIGHT - PADDING_Y - ((value - min) / span) * (HEIGHT - 2 * PADDING_Y),
  ]);

  const line = points.length === 1 ? `M0,${HEIGHT / 2}L${WIDTH},${HEIGHT / 2}` : monotonePath(points);
  const last = points[points.length - 1];

  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("relative inline-block h-8 w-24 shrink-0", TONE_TEXT[tone], className)}
    >
      {points.length > 0 ? (
        <>
          {/* 3 px are left on the right so the end dot is never clipped. */}
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="absolute inset-y-0 left-0 h-full w-[calc(100%-3px)] overflow-visible"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${line}L${WIDTH},${HEIGHT}L0,${HEIGHT}Z`} fill={`url(#${gradientId})`} />
            <path
              d={line}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span
            className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-card"
            style={{
              left: "calc(100% - 3px)",
              top: `${(last[1] / HEIGHT) * 100}%`,
            }}
          />
        </>
      ) : null}
    </span>
  );
}
