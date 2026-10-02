"use client";

import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { getErrorMessage } from "@/lib/api/contract";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  /** Defaults to "Impossible de charger les données". */
  title?: string;
  /** Whatever was thrown: its user-facing message becomes the description. */
  error?: unknown;
  /** Shows a "Réessayer" button, typically wired to `query.refetch`. */
  onRetry?: () => void;
  /** Borderless and tighter, for use inside a card or a panel. */
  compact?: boolean;
  className?: string;
}

/** Shown in place of content that failed to load. */
export function ErrorState({
  title = "Impossible de charger les données",
  error,
  onRetry,
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <Empty
      role="alert"
      className={cn(
        compact
          ? "gap-3 p-6"
          : "min-h-64 border border-solid border-destructive/30 bg-destructive/5 p-8",
        className,
      )}
    >
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className={cn(
            "bg-destructive/10 text-destructive",
            compact ? "mb-1 size-9 rounded-lg" : "size-11 rounded-xl [&_svg:not([class*='size-'])]:size-5",
          )}
        >
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle className={cn(!compact && "text-base")}>{title}</EmptyTitle>
        <EmptyDescription>
          {getErrorMessage(error, "Une erreur est survenue. Réessayez dans un instant.")}
        </EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button type="button" variant="outline" onClick={onRetry}>
            <RotateCw data-icon="inline-start" />
            Réessayer
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
