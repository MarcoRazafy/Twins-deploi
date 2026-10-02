"use client";

import { useId } from "react";
import Link from "next/link";
import { Boxes, Globe, Rocket } from "lucide-react";
import { motion } from "motion/react";

import { ProjectAvatar } from "@/components/shared/project-avatar";
import { RelativeTime } from "@/components/shared/relative-time";
import { Badge } from "@/components/ui/badge";
import { pluralize } from "@/lib/format";
import { hoverLift } from "@/lib/motion";
import { routes } from "@/lib/routes";
import type { ProjectSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ProjectActionsMenu } from "./project-actions-menu";
import { ProjectHealthBadge, ProjectServiceStrip } from "./project-status";

export interface ProjectCardProps {
  project: ProjectSummary;
  className?: string;
}

/** Clickable project tile (links to the workspace). Also used by the dashboard. */
export function ProjectCard({ project, className }: ProjectCardProps) {
  const nameId = useId();
  const healthId = useId();
  const { stats } = project;

  return (
    <motion.article
      {...hoverLift}
      className={cn(
        "group relative h-full rounded-xl border bg-card transition-colors hover:border-border-strong hover:bg-secondary/40",
        className,
      )}
    >
      {/* The link is the card; the menu is its sibling, so a click on "…" can
          never navigate and no interactive element is nested in another. */}
      <Link
        href={routes.workspace(project.id)}
        aria-labelledby={nameId}
        aria-describedby={healthId}
        className="flex h-full flex-col gap-4 rounded-xl p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
      >
        <div className="flex items-center gap-3 pr-10">
          <ProjectAvatar name={project.name} color={project.color} size="lg" />
          <div className="flex min-w-0 items-center gap-2">
            <h3 id={nameId} title={project.name} className="truncate text-base font-medium">
              {project.name}
            </h3>
            <Badge variant="outline" className="shrink-0 capitalize">
              {project.environment}
            </Badge>
          </div>
        </div>

        <p
          className={cn(
            "line-clamp-2 min-h-10 text-sm",
            project.description ? "text-muted-foreground" : "text-subtle",
          )}
        >
          {project.description || "Aucune description"}
        </p>

        <div className="space-y-2.5">
          <ProjectServiceStrip services={project.services} />
          <ProjectHealthBadge id={healthId} stats={stats} />
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-3">
            <span className="inline-flex items-center gap-1.5 tabular">
              <Boxes aria-hidden="true" className="size-3.5" />
              {pluralize(stats.services, "service")}
            </span>
            <span className="inline-flex items-center gap-1.5 tabular">
              <Globe aria-hidden="true" className="size-3.5" />
              {pluralize(stats.domains, "domaine")}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <Rocket aria-hidden="true" className="size-3.5" />
            <RelativeTime date={project.lastDeployment?.createdAt} fallback="Jamais déployé" />
          </span>
        </div>
      </Link>

      <div className="absolute top-5 right-3 sm:top-6 sm:right-4">
        <ProjectActionsMenu project={project} />
      </div>
    </motion.article>
  );
}
