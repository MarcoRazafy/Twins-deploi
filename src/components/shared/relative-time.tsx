"use client";

import { useNow } from "@/hooks/use-now";
import {
  EMPTY_VALUE,
  formatDateTime,
  formatRelativeTime,
  type DateInput,
} from "@/lib/format";

export interface RelativeTimeProps {
  /** ISO string or epoch milliseconds. `null` renders `fallback`. */
  date: DateInput | null | undefined;
  className?: string;
  /** Words placed before the relative time: `prefix="Déployé"` → "Déployé il y a 3 min". */
  prefix?: string;
  /** Shown when there is no date (default "—"). */
  fallback?: string;
}

function toIsoString(date: DateInput): string | undefined {
  const value = date instanceof Date ? date : new Date(date);
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

/**
 * "il y a 3 min" that keeps itself up to date, with the exact date on hover.
 *
 * Nothing time-dependent is rendered on the server or during hydration (a
 * no-break space holds the line height), so there is never a hydration
 * mismatch; the text appears with the first client tick.
 */
export function RelativeTime({
  date,
  className,
  prefix,
  fallback = EMPTY_VALUE,
}: RelativeTimeProps) {
  const now = useNow();

  if (date === null || date === undefined) {
    return <span className={className}>{fallback}</span>;
  }

  const dateTime = toIsoString(date);
  if (now === 0) {
    return (
      <time dateTime={dateTime} className={className}>
        {" "}
      </time>
    );
  }

  const relative = formatRelativeTime(date, now);
  return (
    <time dateTime={dateTime} title={formatDateTime(date)} className={className}>
      {prefix ? `${prefix.trimEnd()} ${relative}` : relative}
    </time>
  );
}
