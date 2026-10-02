"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

import { renderIcon, type IconProp } from "@/components/shared/render-icon";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useHydrated } from "@/hooks/use-hydrated";
import { fadeUp } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: IconProp;
  /** What is missing: "Aucun domaine". */
  title: ReactNode;
  /** One sentence on what to do next. */
  description?: ReactNode;
  /** Primary action, usually the creation button. */
  action?: ReactNode;
  secondaryAction?: ReactNode;
  /**
   * Borderless and tighter, for use inside a card, a table or a panel. The
   * default variant draws its own dashed frame and stands on the page.
   */
  compact?: boolean;
  className?: string;
}

/** "Nothing here yet": icon, title, guidance and the action to get started. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
  className,
}: EmptyStateProps) {
  const hydrated = useHydrated();

  return (
    <Empty
      className={cn(
        compact
          ? "p-6"
          : "min-h-64 border border-border-strong bg-card/40 p-8",
        className,
      )}
    >
      <motion.div
        variants={fadeUp}
        initial={hydrated ? "hidden" : false}
        animate="visible"
        className={cn("flex w-full flex-col items-center", compact ? "gap-3" : "gap-4")}
      >
        <EmptyHeader>
          <EmptyMedia
            variant="icon"
            className={cn(
              "surface-highlight border bg-secondary text-muted-foreground",
              compact ? "mb-1 size-9 rounded-lg" : "size-11 rounded-xl [&_svg:not([class*='size-'])]:size-5",
            )}
          >
            {renderIcon(icon)}
          </EmptyMedia>
          <EmptyTitle className={cn(!compact && "text-base")}>{title}</EmptyTitle>
          {description ? <EmptyDescription>{description}</EmptyDescription> : null}
        </EmptyHeader>
        {action || secondaryAction ? (
          <EmptyContent className="flex-row flex-wrap justify-center gap-2">
            {action}
            {secondaryAction}
          </EmptyContent>
        ) : null}
      </motion.div>
    </Empty>
  );
}
