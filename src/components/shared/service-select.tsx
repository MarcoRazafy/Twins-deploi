"use client";

import { Layers, Share2 } from "lucide-react";

import { ServiceIcon } from "@/components/shared/service-icon";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects, useServices } from "@/lib/queries";
import type { Service, ServiceType } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Radix Select forbids an empty item value, so "all" travels under a sentinel. */
const ALL = "__all__";
/** Value reported (and accepted) for the project-wide shared variables. */
const SHARED = "shared";

export interface ServiceSelectProps {
  /** Restricts the list to one project; without it every service is listed, grouped by project. */
  projectId?: string | null;
  /** A service id, `"shared"` when `includeShared` is set, or `null`. */
  value: string | null;
  /** Receives the service id, `"shared"`, or `null` for "Tous les services". */
  onChange: (value: string | null) => void;
  /** Adds a "Tous les services" option, selected while `value` is `null`. */
  allowAll?: boolean;
  /** Adds a "Variables partagées" option reporting `"shared"`. */
  includeShared?: boolean;
  /** Keeps only these kinds of service (e.g. `["github", "docker"]` for deployable ones). */
  types?: ServiceType[];
  /** The trigger is `w-52` by default: override the width here. */
  className?: string;
  /** Shown while nothing is selected (default "Choisir un service"). */
  placeholder?: string;
  /** Lets a `FieldLabel` point at the trigger. */
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
}

function ServiceOption({ service }: { service: Service }) {
  return (
    <SelectItem value={service.id}>
      <ServiceIcon type={service.source.type} />
      <span className="truncate">{service.name}</span>
    </SelectItem>
  );
}

/** Select of services (one project or all), with their brand marks. */
export function ServiceSelect({
  projectId,
  value,
  onChange,
  allowAll = false,
  includeShared = false,
  types,
  className,
  placeholder = "Choisir un service",
  id,
  "aria-label": ariaLabel,
  disabled,
}: ServiceSelectProps) {
  const services = useServices(projectId ? { projectId } : undefined);
  // Only needed to title the groups when the services of every project are listed.
  const projects = useProjects();

  if (services.isPending || (!projectId && projects.isPending)) {
    return <Skeleton aria-busy="true" className={cn("h-8 w-52 rounded-lg", className)} />;
  }

  const visible = (services.data ?? []).filter(
    (service) => !types || types.includes(service.source.type),
  );
  const groups = projectId
    ? []
    : (projects.data ?? [])
        .map((project) => ({
          project,
          services: visible.filter((service) => service.projectId === project.id),
        }))
        .filter((group) => group.services.length > 0);

  const hasExtraOptions = allowAll || includeShared;
  const isError = services.isError;

  return (
    <Select
      value={value ?? (allowAll ? ALL : "")}
      onValueChange={(next) => onChange(next === ALL ? null : next)}
      disabled={disabled || isError}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-52", className)}>
        <SelectValue placeholder={isError ? "Services indisponibles" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAll ? (
          <SelectItem value={ALL}>
            <Layers className="text-muted-foreground" />
            Tous les services
          </SelectItem>
        ) : null}
        {includeShared ? (
          <SelectItem value={SHARED}>
            <Share2 className="text-muted-foreground" />
            Variables partagées
          </SelectItem>
        ) : null}
        {hasExtraOptions && visible.length > 0 ? <SelectSeparator /> : null}
        {projectId
          ? visible.map((service) => <ServiceOption key={service.id} service={service} />)
          : groups.map(({ project, services: projectServices }) => (
              <SelectGroup key={project.id}>
                <SelectLabel>{project.name}</SelectLabel>
                {projectServices.map((service) => (
                  <ServiceOption key={service.id} service={service} />
                ))}
              </SelectGroup>
            ))}
      </SelectContent>
    </Select>
  );
}
