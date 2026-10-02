import { Fragment } from "react";

import { CopyButton } from "@/components/shared/copy-button";
import { cn } from "@/lib/utils";

/** Line-comment marker per language, the only "highlighting" we do. */
const COMMENT_MARKERS: Record<string, string> = {
  bash: "#",
  sh: "#",
  shell: "#",
  env: "#",
  dotenv: "#",
  yaml: "#",
  yml: "#",
  toml: "#",
  dockerfile: "#",
  nginx: "#",
  python: "#",
  sql: "--",
  js: "//",
  javascript: "//",
  ts: "//",
  typescript: "//",
};

export interface CodeBlockProps {
  code: string;
  /** File name or caption shown in the header. */
  title?: string;
  /** Shown in the header; also enables dimmed comment lines ("bash", "sql"…). */
  language?: string;
  /** Adds a copy button (default true). */
  copyable?: boolean;
  /** The block scrolls beyond this height (pixels or any CSS length). */
  maxHeight?: number | string;
  /** Wrap long lines instead of scrolling horizontally. */
  wrap?: boolean;
  className?: string;
}

/**
 * Monospace block for commands, configuration and connection snippets.
 * Deliberately free of a syntax-highlighting dependency: comment lines are
 * dimmed, everything else is plain text.
 */
export function CodeBlock({
  code,
  title,
  language,
  copyable = true,
  maxHeight,
  wrap = false,
  className,
}: CodeBlockProps) {
  const hasHeader = Boolean(title || language);
  const commentMarker = language ? COMMENT_MARKERS[language.toLowerCase()] : undefined;
  const lines = commentMarker ? code.split("\n") : null;

  return (
    <div
      data-slot="code-block"
      className={cn("relative overflow-hidden rounded-lg border bg-background", className)}
    >
      {hasHeader ? (
        <div className="flex h-9 items-center justify-between gap-3 border-b bg-secondary/40 pr-1.5 pl-3">
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {title}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {language ? (
              <span className="text-[11px] font-medium text-muted-foreground">{language}</span>
            ) : null}
            {copyable ? <CopyButton value={code} size="icon-xs" /> : null}
          </div>
        </div>
      ) : null}

      {/* Focusable so keyboard users can scroll an overflowing block. */}
      <pre
        tabIndex={0}
        style={{ maxHeight }}
        className={cn(
          "overflow-auto p-3 font-mono text-[13px] leading-relaxed text-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
          wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre",
          !hasHeader && copyable && "pr-11",
        )}
      >
        <code>
          {lines
            ? lines.map((line, index) => (
                <Fragment key={index}>
                  {index > 0 ? "\n" : null}
                  <span
                    className={
                      line.trimStart().startsWith(commentMarker ?? "")
                        ? "text-muted-foreground"
                        : undefined
                    }
                  >
                    {line}
                  </span>
                </Fragment>
              ))
            : code}
        </code>
      </pre>

      {!hasHeader && copyable ? (
        <CopyButton value={code} size="icon-xs" className="absolute top-2 right-2" />
      ) : null}
    </div>
  );
}
