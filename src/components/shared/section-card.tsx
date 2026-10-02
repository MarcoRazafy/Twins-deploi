import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SectionCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** Controls aligned with the title (a switch, a secondary button…). */
  actions?: ReactNode;
  /** Bottom bar: a hint on the left, the save button on the right. */
  footer?: ReactNode;
  /** "danger" tints the block for destructive settings. */
  tone?: "default" | "danger";
  children?: ReactNode;
  /** Anchor target, e.g. for `?section=` deep links. */
  id?: string;
  /** Drops the body padding for content that runs edge to edge (tables). */
  flush?: boolean;
  className?: string;
}

/** Settings-style block: header, body and an optional footer bar. */
export function SectionCard({
  title,
  description,
  actions,
  footer,
  tone = "default",
  children,
  id,
  flush = false,
  className,
}: SectionCardProps) {
  const titleId = useId();
  const danger = tone === "danger";

  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(
        "scroll-mt-24 rounded-xl border bg-card",
        danger && "border-destructive/30 bg-destructive/5",
        className,
      )}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-base font-medium">
            {title}
          </h2>
          {description ? (
            <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {children != null && children !== false ? (
        <div className={cn(!flush && "px-4 pb-4 sm:px-5 sm:pb-5")}>{children}</div>
      ) : null}

      {footer ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t bg-secondary/40 px-4 py-3 text-sm text-muted-foreground sm:px-5",
            danger && "border-destructive/20 bg-destructive/5",
          )}
        >
          {footer}
        </div>
      ) : null}
    </section>
  );
}
