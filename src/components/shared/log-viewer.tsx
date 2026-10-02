"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  Check,
  Clock,
  Copy,
  Download,
  ScrollText,
  WrapText,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { SearchInput } from "@/components/shared/search-input";
import { StatusDot } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatNumber, formatTime, pluralize } from "@/lib/format";
import { fadeUp } from "@/lib/motion";
import { LOG_LEVEL_CLASSES, LOG_STREAM_LABELS } from "@/lib/status";
import type { LogLine, LogStream } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Rows kept in the DOM. Older lines stay available to copy and download. */
const MAX_RENDERED_LINES = 5000;
/**
 * Above this many rows, off-screen rows skip layout and paint
 * (`content-visibility`). Shorter logs render normally, which also keeps them
 * visible in full-page screenshots and when printing.
 */
const LAZY_PAINT_THRESHOLD = 300;
/** Scrolling further than this from the end (px) stops following. */
const PAUSE_DISTANCE = 32;
/** Following resumes once the view is back within this distance (px) of the end. */
const RESUME_DISTANCE = 4;
/** Keys that express "I want to read what is above". */
const SCROLL_BACK_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);
const STREAM_ORDER: LogStream[] = ["build", "deploy", "runtime"];
const SKELETON_WIDTHS = ["62%", "48%", "81%", "37%", "70%", "55%", "88%", "43%", "66%", "52%"];
// Colour codes emitted by build tools; built from the char code because a
// literal escape character in a regex trips the no-control-regex rule.
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

const STREAM_ITEM_CLASSES =
  "text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground";

type StreamFilter = "all" | LogStream;

export interface LogViewerProps {
  /** Oldest first. Keep line objects stable between renders (append, don't rebuild). */
  lines: LogLine[];
  /** More lines are expected: shows the live indicator and the blinking caret. */
  streaming?: boolean;
  /** Shows a skeleton instead of the lines. */
  loading?: boolean;
  title?: string;
  /** Shown when there is no line at all (default "Aucun log pour le moment"). */
  emptyMessage?: string;
  className?: string;
  /** Total height, toolbar included: pixels or any CSS length (default 420). */
  height?: number | string;
  /**
   * Build / Deploy filter. By default it appears when the lines come from
   * more than one stream; pass `true` to reserve its place from the start
   * (a deployment that is still building) or `false` to never show it.
   */
  showStreamFilter?: boolean;
  /** Base name of the downloaded file (default "logs" → "logs.log"). */
  downloadName?: string;
}

function cleanMessage(message: string): string {
  return message.includes("\u001b") ? message.replace(ANSI_PATTERN, "") : message;
}

function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const haystack = text.toLowerCase();
  let match = haystack.indexOf(query);
  if (match === -1) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  while (match !== -1) {
    if (match > cursor) parts.push(text.slice(cursor, match));
    parts.push(
      <mark key={match} className="rounded-[3px] bg-warning/30 text-foreground">
        {text.slice(match, match + query.length)}
      </mark>,
    );
    cursor = match + query.length;
    match = haystack.indexOf(query, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function toExportLine(line: LogLine): string {
  return `${line.ts} [${line.stream}] ${line.level.toUpperCase().padEnd(7)} ${cleanMessage(line.message)}`;
}

interface LogRowProps {
  line: LogLine;
  showTimestamp: boolean;
  wrap: boolean;
  /** Lower-cased search text. */
  query: string;
  /** Let the browser skip this row while it is off-screen. */
  lazyPaint: boolean;
}

// Memoised: appending lines to a long log must only render the new rows.
const LogRow = memo(function LogRow({ line, showTimestamp, wrap, query, lazyPaint }: LogRowProps) {
  return (
    <div
      data-level={line.level}
      className={cn(
        "flex gap-3 border-l-2 border-transparent px-3 hover:bg-accent/40",
        // Keeps a log of a few thousand lines smooth without a windowing library.
        lazyPaint && "[contain-intrinsic-size:auto_20px] [content-visibility:auto]",
        line.level === "error" && "border-destructive/70 bg-destructive/5",
        line.level === "warn" && "border-warning/60 bg-warning/5",
      )}
    >
      {showTimestamp ? (
        <time dateTime={line.ts} className="tabular shrink-0 text-muted-foreground select-none">
          {formatTime(line.ts)}
        </time>
      ) : null}
      <span
        className={cn(
          "min-w-0",
          wrap ? "break-words whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre",
          LOG_LEVEL_CLASSES[line.level],
        )}
      >
        {highlight(cleanMessage(line.message), query)}
      </span>
    </div>
  );
});

/**
 * Log console: stream filter, search with highlighted matches, timestamp and
 * wrapping toggles, copy and download. While `streaming` it stays pinned to
 * the newest line until the user scrolls up; "Suivre" resumes.
 */
export function LogViewer({
  lines,
  streaming = false,
  loading = false,
  title,
  emptyMessage = "Aucun log pour le moment",
  className,
  height = 420,
  showStreamFilter,
  downloadName = "logs",
}: LogViewerProps) {
  const [stream, setStream] = useState<StreamFilter>("all");
  const [search, setSearch] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [following, setFollowing] = useState(true);
  /** Line count when the user left the bottom: gives "n nouvelles lignes". */
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopyToClipboard();

  const query = useDebouncedValue(search, 150).trim().toLowerCase();

  const streams = useMemo(() => {
    const present = new Set<LogStream>();
    for (const line of lines) {
      present.add(line.stream);
      if (present.size === STREAM_ORDER.length) break;
    }
    return STREAM_ORDER.filter((candidate) => present.has(candidate));
  }, [lines]);

  const filterVisible = showStreamFilter ?? streams.length > 1;
  // A filter that is not displayed must not keep hiding lines.
  const activeStream: StreamFilter = filterVisible ? stream : "all";
  const filterOptions = STREAM_ORDER.filter(
    (candidate) => candidate !== "runtime" || streams.includes("runtime"),
  );

  const visible = useMemo(() => {
    if (activeStream === "all" && !query) return lines;
    return lines.filter(
      (line) =>
        (activeStream === "all" || line.stream === activeStream) &&
        (!query || cleanMessage(line.message).toLowerCase().includes(query)),
    );
  }, [lines, activeStream, query]);

  const truncated = visible.length > MAX_RENDERED_LINES;
  const rendered = truncated ? visible.slice(-MAX_RENDERED_LINES) : visible;
  const filtering = activeStream !== "all" || query !== "";
  const newLines = pausedAt === null ? 0 : Math.max(0, lines.length - pausedAt);

  // Pin to the newest line. A layout effect, so the jump happens before paint.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (following && scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [following, rendered.length, wrap, showTimestamps, loading]);

  function pause() {
    setFollowing(false);
    setPausedAt(lines.length);
  }

  function resume() {
    setFollowing(true);
    setPausedAt(null);
  }

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (following) {
      if (distance > PAUSE_DISTANCE) pause();
    } else if (distance <= RESUME_DISTANCE) {
      resume();
    }
  }

  // While lines pour in, a small upward scroll would be undone by the next
  // append before it ever reaches the pause distance: an explicit upward
  // gesture stops following straight away.
  function pauseOnScrollBack() {
    const scroller = scrollerRef.current;
    if (following && scroller && scroller.scrollHeight > scroller.clientHeight) pause();
  }

  function toText(): string {
    return visible
      .map((line) =>
        showTimestamps
          ? `${formatTime(line.ts)} ${cleanMessage(line.message)}`
          : cleanMessage(line.message),
      )
      .join("\n");
  }

  function download() {
    const blob = new Blob([visible.map(toExportLine).join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName.endsWith(".log") ? downloadName : `${downloadName}.log`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking right away can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const hasLines = lines.length > 0;

  return (
    <div
      data-slot="log-viewer"
      style={{ height }}
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card", className)}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        {title || streaming ? (
          <div className="flex min-w-0 items-center gap-2.5 max-sm:w-full">
            {title ? <span className="truncate text-sm font-medium">{title}</span> : null}
            {streaming ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-info">
                <StatusDot tone="info" pulse />
                En direct
              </span>
            ) : null}
          </div>
        ) : null}

        {filterVisible ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={activeStream}
            aria-label="Filtrer par flux"
            onValueChange={(next: string) => {
              // Radix sends "" when the active item is pressed again: keep it.
              if (next) setStream(next as StreamFilter);
            }}
          >
            <ToggleGroupItem value="all" className={STREAM_ITEM_CLASSES}>
              Tous
            </ToggleGroupItem>
            {filterOptions.map((option) => (
              <ToggleGroupItem key={option} value={option} className={STREAM_ITEM_CLASSES}>
                {LOG_STREAM_LABELS[option]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Rechercher dans les logs"
          className="order-last w-full sm:order-none sm:w-56"
        />

        <span className="tabular ml-auto text-xs whitespace-nowrap text-muted-foreground max-sm:hidden">
          {filtering
            ? `${formatNumber(visible.length)} sur ${pluralize(lines.length, "ligne")}`
            : pluralize(lines.length, "ligne")}
        </span>

        <div className="flex items-center gap-0.5 max-sm:ml-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={showTimestamps}
                onPressedChange={setShowTimestamps}
                aria-label="Afficher l’horodatage"
              >
                <Clock />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Horodatage</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={wrap}
                onPressedChange={setWrap}
                aria-label="Retour à la ligne automatique"
              >
                <WrapText />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Retour à la ligne</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={visible.length === 0}
                aria-label="Copier les logs"
                onClick={() => void copy(toText())}
              >
                {copied ? <Check className="text-success" /> : <Copy />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? "Copié" : "Copier les logs"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={visible.length === 0}
                aria-label="Télécharger les logs"
                onClick={download}
              >
                <Download />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Télécharger (.log)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-background">
        <div
          ref={scrollerRef}
          role="log"
          aria-label={title ?? "Logs"}
          aria-busy={loading || undefined}
          tabIndex={0}
          onScroll={handleScroll}
          onWheel={(event) => {
            if (event.deltaY < 0) pauseOnScrollBack();
          }}
          onKeyDown={(event) => {
            if (SCROLL_BACK_KEYS.has(event.key)) pauseOnScrollBack();
          }}
          className="size-full overflow-auto py-2 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset sm:text-[13px]"
        >
          {loading ? (
            <div className="space-y-2.5 px-3 py-1">
              {SKELETON_WIDTHS.map((width, index) => (
                <Skeleton key={index} className="h-3" style={{ width }} />
              ))}
            </div>
          ) : rendered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center font-sans text-sm text-muted-foreground">
              <ScrollText aria-hidden="true" className="size-5" />
              {hasLines ? "Aucune ligne ne correspond aux filtres" : emptyMessage}
              {!hasLines && streaming ? (
                <span className="text-xs">En attente des premières lignes…</span>
              ) : null}
            </div>
          ) : (
            <div className={cn(!wrap && "w-max min-w-full")}>
              {truncated ? (
                <p className="px-3 pb-1 font-sans text-xs text-muted-foreground">
                  Affichage des {formatNumber(MAX_RENDERED_LINES)} dernières lignes. Le
                  téléchargement contient l’intégralité des logs.
                </p>
              ) : null}
              {rendered.map((line) => (
                <LogRow
                  key={line.id}
                  line={line}
                  showTimestamp={showTimestamps}
                  wrap={wrap}
                  query={query}
                  lazyPaint={rendered.length > LAZY_PAINT_THRESHOLD}
                />
              ))}
              {streaming ? (
                <div aria-hidden="true" className="flex h-5 items-center px-3 pl-3.5">
                  <span className="h-3.5 w-[7px] animate-caret-blink bg-foreground/70" />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <AnimatePresence>
          {!following && !loading && rendered.length > 0 ? (
            <motion.div
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="absolute right-3 bottom-3"
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="border-border-strong shadow-lg shadow-black/40"
                onClick={resume}
              >
                <ArrowDown data-icon="inline-start" />
                {streaming ? "Suivre" : "Aller à la fin"}
                {newLines > 0 ? (
                  <span className="tabular text-muted-foreground">
                    · {formatNumber(newLines)}
                  </span>
                ) : null}
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
