"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import type { ReactNode, Ref } from "react";

import { ProjectAvatar } from "@/components/shared/project-avatar";
import { StatusDot } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { Project, Service } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Rounded frame of the canvas, separated from the window edges. Every state of
 * the workspace (loading, error, canvas) renders inside this one element so
 * the measured size never changes identity.
 */
export function WorkspaceFrame({
  ref,
  children,
  dots = false,
  busy,
}: {
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
  /** Static dot grid, for states without a live canvas. */
  dots?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="h-full p-2 sm:p-3">
      <div
        ref={ref}
        aria-busy={busy}
        className={cn(
          "relative h-full touch-none overflow-hidden rounded-xl border bg-background",
          dots && "bg-dot-grid",
        )}
      >
        {children}
      </div>
    </div>
  );
}

const SKELETON_CARDS = [
  "left-[12%] top-[26%]",
  "left-[44%] top-[18%]",
  "left-[30%] top-[56%]",
] as const;

/** Loading state: the shape of the final canvas (chip, button, a few cards). */
export function CanvasSkeleton() {
  return (
    <>
      <Skeleton className="absolute top-3 left-3 h-9 w-48 rounded-lg" />
      <Skeleton className="absolute top-3 right-3 h-8 w-24 rounded-lg" />
      {SKELETON_CARDS.map((position) => (
        <Skeleton
          key={position}
          className={cn("absolute h-[136px] w-[272px] max-w-[60%] rounded-xl", position)}
        />
      ))}
      <Skeleton className="absolute bottom-3 left-3 h-32 w-9 rounded-lg" />
    </>
  );
}

/** Top-left chip: project name, services count, health summary, settings link. */
export function ProjectChip({
  project,
  services,
  maxWidth,
}: {
  project: Project;
  services: readonly Service[];
  /** Overrides the default width cap (px), e.g. while the service panel is open. */
  maxWidth?: number;
}) {
  const online = services.filter((service) => service.status === "online").length;
  const crashed = services.filter((service) => service.status === "crashed").length;
  const inProgress = services.filter(
    (service) =>
      service.status === "building" ||
      service.status === "deploying" ||
      service.status === "restarting",
  ).length;

  return (
    <div
      className="absolute top-3 left-3 z-10 flex h-9 max-w-[calc(100%-8.5rem)] items-center gap-2 rounded-lg border bg-card/90 pr-1 pl-2 shadow-lg shadow-black/30 backdrop-blur sm:max-w-[calc(100%-16rem)]"
      style={maxWidth === undefined ? undefined : { maxWidth }}
      data-canvas-ui
    >
      <ProjectAvatar name={project.name} color={project.color} size="xs" />
      <span className="min-w-0 truncate text-sm font-medium" title={project.name}>
        {project.name}
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {pluralize(services.length, "service")}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs tabular" aria-label="Santé des services">
        {online > 0 ? (
          <span className="flex items-center gap-1 text-muted-foreground" title="En ligne">
            <StatusDot tone="success" />
            {online}
          </span>
        ) : null}
        {inProgress > 0 ? (
          <span className="flex items-center gap-1 text-muted-foreground" title="En cours">
            <StatusDot tone="info" pulse />
            {inProgress}
          </span>
        ) : null}
        {crashed > 0 ? (
          <span className="flex items-center gap-1 text-destructive" title="En erreur">
            <StatusDot tone="danger" />
            {crashed}
          </span>
        ) : null}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
            <Link href={routes.projectSettings(project.id)} aria-label="Réglages du projet">
              <Settings />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Réglages du projet</TooltipContent>
      </Tooltip>
    </div>
  );
}
