"use client";

import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusDot } from "@/components/shared/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pluralize } from "@/lib/format";
import { SERVICE_STATUS, TONE_CLASSES } from "@/lib/status";
import type { ProjectStats, ServicePreview } from "@/lib/types";
import { cn } from "@/lib/utils";

import { getProjectHealth } from "../lib/project-health";

interface ProjectHealthBadgeProps {
  stats: ProjectStats;
  id?: string;
  className?: string;
}

/** The one-sentence health of a project: a dot and a label, never colour alone. */
export function ProjectHealthBadge({ stats, id, className }: ProjectHealthBadgeProps) {
  const health = getProjectHealth(stats);

  return (
    <span
      id={id}
      className={cn(
        "inline-flex items-center gap-2 text-sm font-medium",
        TONE_CLASSES[health.tone].text,
        className,
      )}
    >
      <StatusDot tone={health.tone} pulse={health.pulse} />
      {health.label}
    </span>
  );
}

const MAX_VISIBLE_SERVICES = 5;

interface ProjectServiceStripProps {
  services: readonly ServicePreview[];
  className?: string;
}

/** Brand tiles of the services of a project, each with its live status dot. */
export function ProjectServiceStrip({ services, className }: ProjectServiceStripProps) {
  if (services.length === 0) {
    return (
      <p className={cn("flex h-7 items-center text-xs text-muted-foreground", className)}>
        Workspace vide
      </p>
    );
  }

  const visible = services.slice(0, MAX_VISIBLE_SERVICES);
  const hidden = services.slice(MAX_VISIBLE_SERVICES);

  return (
    <ul className={cn("flex items-center gap-1.5", className)}>
      {visible.map((service) => {
        const status = SERVICE_STATUS[service.status];
        return (
          <li key={service.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="relative block">
                  <ServiceIcon type={service.type} tile="sm" className="border" />
                  <StatusDot
                    tone={status.tone}
                    pulse={status.pulse}
                    className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card"
                  />
                  <span className="sr-only">
                    {service.name}, {status.label}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {service.name} · {status.label}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
      {hidden.length > 0 ? (
        <li>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="grid h-7 min-w-7 place-items-center rounded-md border bg-secondary px-1.5 text-xs font-medium text-muted-foreground tabular">
                <span aria-hidden="true">+{hidden.length}</span>
                <span className="sr-only">
                  et {pluralize(hidden.length, "autre service", "autres services")}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{hidden.map((service) => service.name).join(", ")}</TooltipContent>
          </Tooltip>
        </li>
      ) : null}
    </ul>
  );
}
