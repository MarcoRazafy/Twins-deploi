"use client";

import { LayoutGrid } from "lucide-react";

import { ProjectAvatar } from "@/components/shared/project-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Radix Select forbids an empty item value, so "all" travels under a sentinel. */
const ALL = "__all__";

export interface ProjectSelectProps {
  value: string | null;
  /** Receives the project id, or `null` for "Tous les projets". */
  onChange: (value: string | null) => void;
  /** Adds a "Tous les projets" option, selected while `value` is `null`. */
  allowAll?: boolean;
  /** The trigger is `w-52` by default: override the width here. */
  className?: string;
  /** Shown while nothing is selected (default "Choisir un projet"). */
  placeholder?: string;
  /** Lets a `FieldLabel` point at the trigger. */
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
}

/** Select of the user's projects, with their avatars. */
export function ProjectSelect({
  value,
  onChange,
  allowAll = false,
  className,
  placeholder = "Choisir un projet",
  id,
  "aria-label": ariaLabel,
  disabled,
}: ProjectSelectProps) {
  const { data: projects, isPending, isError } = useProjects();

  if (isPending) {
    return <Skeleton aria-busy="true" className={cn("h-8 w-52 rounded-lg", className)} />;
  }

  return (
    <Select
      value={value ?? (allowAll ? ALL : "")}
      onValueChange={(next) => onChange(next === ALL ? null : next)}
      disabled={disabled || isError}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-52", className)}>
        <SelectValue placeholder={isError ? "Projets indisponibles" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAll ? (
          <SelectItem value={ALL}>
            <LayoutGrid className="text-muted-foreground" />
            Tous les projets
          </SelectItem>
        ) : null}
        {(projects ?? []).map((project) => (
          <SelectItem key={project.id} value={project.id}>
            <ProjectAvatar name={project.name} color={project.color} size="xs" />
            <span className="truncate">{project.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
