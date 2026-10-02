/**
 * fr-FR formatting helpers. Every function is pure: anything time-relative
 * takes `now` as an argument (see `useNow`) instead of reading the clock.
 *
 * Dates arrive as ISO strings or epoch milliseconds, the two shapes used by
 * the domain model. A number and its unit are joined by a no-break space so a
 * value never wraps away from its unit.
 */

export type DateInput = string | number | Date;

const LOCALE = "fr-FR";
const NBSP = " ";
/** Rendered in place of a value that cannot be formatted. */
export const EMPTY_VALUE = "—";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Intl formatters are expensive to build: create each one once.
const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dayMonthFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
});
const compactFormatter = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const numberFormatters = new Map<string, Intl.NumberFormat>();

function numberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = JSON.stringify(options);
  let formatter = numberFormatters.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, options);
    numberFormatters.set(cacheKey, formatter);
  }
  return formatter;
}

function toDate(input: DateInput): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function decimal(value: number, maximumFractionDigits = 1): string {
  return numberFormatter({ maximumFractionDigits }).format(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

/** "1 oct. 2026" */
export function formatDate(date: DateInput): string {
  const value = toDate(date);
  return value ? dateFormatter.format(value) : EMPTY_VALUE;
}

/** "1 oct." within the year of `now`, "1 oct. 2025" otherwise. */
export function formatShortDate(date: DateInput, now: number | Date): string {
  const value = toDate(date);
  if (!value) return EMPTY_VALUE;
  const reference = typeof now === "number" ? new Date(now) : now;
  return value.getFullYear() === reference.getFullYear()
    ? dayMonthFormatter.format(value)
    : dateFormatter.format(value);
}

/** "23:19:57" (24 h, with seconds: used by logs). */
export function formatTime(date: DateInput): string {
  const value = toDate(date);
  if (!value) return EMPTY_VALUE;
  // Built by hand: log viewers format thousands of lines and Intl is slow.
  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`;
}

/** "1 oct. 2026 à 23:19" */
export function formatDateTime(date: DateInput): string {
  const value = toDate(date);
  if (!value) return EMPTY_VALUE;
  return `${dateFormatter.format(value)} à ${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

/**
 * "à l’instant", "il y a 3 min", "il y a 2 h", "hier", "il y a 5 j", then a
 * short date after 30 days. Future dates read "dans 3 min", "demain"…
 *
 * `now` normally comes from `useNow()`. While that hook reports 0 (not
 * ticking yet) the absolute date is returned, which is always correct.
 */
export function formatRelativeTime(date: DateInput, now: number | Date): string {
  const value = toDate(date);
  if (!value) return EMPTY_VALUE;
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (!nowMs || Number.isNaN(nowMs)) return formatDate(value);

  const diff = nowMs - value.getTime();
  const elapsed = Math.abs(diff);
  const past = diff >= 0;

  // Also covers dates a few seconds ahead of a `now` that ticks every 30 s.
  if (elapsed < 45 * SECOND) return "à l’instant";
  if (elapsed < HOUR) {
    const minutes = Math.max(1, Math.floor(elapsed / MINUTE));
    return past ? `il y a ${minutes}${NBSP}min` : `dans ${minutes}${NBSP}min`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return past ? `il y a ${hours}${NBSP}h` : `dans ${hours}${NBSP}h`;
  }

  // Calendar days, so 30 hours ago reads "hier" or "il y a 2 j" correctly.
  const days = Math.round(
    Math.abs(startOfDay(new Date(nowMs)) - startOfDay(value)) / DAY,
  );
  if (days <= 1) return past ? "hier" : "demain";
  if (days < 30) return past ? `il y a ${days}${NBSP}j` : `dans ${days}${NBSP}j`;
  return formatShortDate(value, nowMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Durations
// ─────────────────────────────────────────────────────────────────────────────

/** "350 ms", "42 s", "2 min 05 s", "1 h 12 min", "3 j 4 h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return EMPTY_VALUE;
  if (ms < SECOND) return `${Math.round(ms)}${NBSP}ms`;

  const totalSeconds = Math.round(ms / SECOND);
  if (totalSeconds < 60) return `${totalSeconds}${NBSP}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}${NBSP}min${NBSP}${pad2(totalSeconds % 60)}${NBSP}s`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return `${totalHours}${NBSP}h${NBSP}${pad2(totalMinutes % 60)}${NBSP}min`;
  }

  return `${Math.floor(totalHours / 24)}${NBSP}j${NBSP}${totalHours % 24}${NBSP}h`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sizes (binary multiples, French unit names)
// ─────────────────────────────────────────────────────────────────────────────

/** "512 Mo", "1,5 Go", "2 To" — picks the unit from the magnitude. */
export function formatMegabytes(mb: number): string {
  if (!Number.isFinite(mb)) return EMPTY_VALUE;
  const size = Math.abs(mb);
  if (size >= 1024 * 1024) return `${decimal(mb / (1024 * 1024))}${NBSP}To`;
  if (size >= 1024) return `${decimal(mb / 1024)}${NBSP}Go`;
  if (size > 0 && size < 1) return `${decimal(mb * 1024, 0)}${NBSP}Ko`;
  return `${decimal(mb, size < 10 ? 1 : 0)}${NBSP}Mo`;
}

/** "5 Go", "1,5 Go", and megabytes below 1 Go ("512 Mo"). */
export function formatGigabytes(gb: number): string {
  if (!Number.isFinite(gb)) return EMPTY_VALUE;
  return formatMegabytes(gb * 1024);
}

/** "512 Ko", "1,5 Mo". */
export function formatKilobytes(kb: number): string {
  if (!Number.isFinite(kb)) return EMPTY_VALUE;
  if (Math.abs(kb) < 1024) return `${decimal(kb, 0)}${NBSP}Ko`;
  return formatMegabytes(kb / 1024);
}

// ─────────────────────────────────────────────────────────────────────────────
// Numbers
// ─────────────────────────────────────────────────────────────────────────────

/** `value` is on a 0–100 scale: `formatPercent(42.5, 1)` → "42,5 %". */
export function formatPercent(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  return `${decimal(value, fractionDigits)}${NBSP}%`;
}

/** "1 234", "12,5" — at most two decimals unless `options` says otherwise. */
export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 2 },
): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  return numberFormatter(options).format(value);
}

/** "950", "1,2 k", "3,4 M". */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  return compactFormatter.format(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Text
// ─────────────────────────────────────────────────────────────────────────────

/** First 7 characters of a commit SHA. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * "3 services", "1 service", "0 service" (French: plural from 2).
 * `plural` defaults to the singular followed by "s".
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  const word = Math.abs(count) >= 2 ? (plural ?? `${singular}s`) : singular;
  return `${formatNumber(count)}${NBSP}${word}`;
}

/** "Marco Razafy" → "MR", "cancham-app" → "CA", "Postgres" → "PO". */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_./@]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length === 1
      ? Array.from(words[0]).slice(0, 2)
      : words.slice(0, 2).map((word) => Array.from(word)[0]);
  return letters.join("").toUpperCase();
}

/** "Mon Projet Été" → "mon-projet-ete". */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
