"use client";

import type { ReactNode } from "react";
import { Share2 } from "lucide-react";
import { motion } from "motion/react";

import { ProjectSelect } from "@/components/shared/project-select";
import { ServiceIcon } from "@/components/shared/service-icon";
import { ServiceSelect } from "@/components/shared/service-select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SPRING } from "@/lib/motion";
import type { Service } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ScopeCount {
  total: number;
  secrets: number;
}

interface ScopeItemProps {
  active: boolean;
  label: string;
  icon: ReactNode;
  /** Undefined while the counts load. */
  count: number | undefined;
  onSelect: () => void;
}

function ScopeItem({ active, label, icon, count, onSelect }: ScopeItemProps) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "text-foreground" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      {active ? (
        <motion.span
          layoutId="variables-scope-indicator"
          transition={SPRING.snappy}
          aria-hidden="true"
          className="absolute inset-0 rounded-lg bg-accent before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand-400"
        />
      ) : null}
      <span className="relative flex min-w-0 flex-1 items-center gap-2.5">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {count === undefined ? (
        <Skeleton className="relative h-5 w-6 rounded-full" />
      ) : (
        <Badge variant="secondary" className="relative tabular">
          {count}
        </Badge>
      )}
    </button>
  );
}

export interface ScopeRailProps {
  projectId: string;
  /** null = the shared scope. */
  serviceId: string | null;
  services: readonly Service[] | undefined;
  /** Variable counts per scope (`null` key = shared), undefined while loading. */
  counts: ReadonlyMap<string | null, ScopeCount> | undefined;
  onProjectChange: (projectId: string | null) => void;
  onScopeChange: (serviceId: string | null) => void;
}

/** Desktop navigation: the project on top, then shared variables and each service. */
export function ScopeRail({
  projectId,
  serviceId,
  services,
  counts,
  onProjectChange,
  onScopeChange,
}: ScopeRailProps) {
  return (
    <nav aria-label="Portée des variables" className="flex flex-col gap-3 lg:sticky lg:top-6">
      <ProjectSelect
        value={projectId}
        onChange={onProjectChange}
        aria-label="Projet"
        className="w-full"
      />
      <ul className="flex flex-col gap-0.5">
        <li>
          <ScopeItem
            active={serviceId === null}
            label="Variables partagées"
            icon={<Share2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            count={counts ? (counts.get(null)?.total ?? 0) : undefined}
            onSelect={() => onScopeChange(null)}
          />
        </li>
        <li className="px-2.5 pt-3 pb-1 text-xs font-medium text-muted-foreground">Services</li>
        {services
          ? services.map((service) => (
              <li key={service.id}>
                <ScopeItem
                  active={serviceId === service.id}
                  label={service.name}
                  icon={<ServiceIcon type={service.source.type} className="shrink-0" />}
                  count={counts ? (counts.get(service.id)?.total ?? 0) : undefined}
                  onSelect={() => onScopeChange(service.id)}
                />
              </li>
            ))
          : [0, 1, 2].map((row) => (
              <li key={row} className="px-2.5 py-2">
                <Skeleton className="h-5 w-full" />
              </li>
            ))}
      </ul>
    </nav>
  );
}

export interface ScopePickersProps {
  projectId: string;
  serviceId: string | null;
  onProjectChange: (projectId: string | null) => void;
  onScopeChange: (serviceId: string | null) => void;
  className?: string;
}

/** Below `lg` the rail collapses into two selects above the editor. */
export function ScopePickers({
  projectId,
  serviceId,
  onProjectChange,
  onScopeChange,
  className,
}: ScopePickersProps) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row", className)}>
      <ProjectSelect
        value={projectId}
        onChange={onProjectChange}
        aria-label="Projet"
        className="w-full sm:w-52"
      />
      <ServiceSelect
        projectId={projectId}
        includeShared
        value={serviceId ?? "shared"}
        onChange={(next) => onScopeChange(next === null || next === "shared" ? null : next)}
        aria-label="Portée des variables"
        className="w-full sm:w-60"
      />
    </div>
  );
}
