"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, FolderOpen, LayoutGrid, Plus } from "lucide-react";

import { ProjectAvatar } from "@/components/shared/project-avatar";
import { StatusDot } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { pluralize } from "@/lib/format";
import { useProjects } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { StatusTone } from "@/lib/status";
import type { ProjectStats } from "@/lib/types";

interface ProjectHealth {
  tone: StatusTone;
  pulse: boolean;
  label: string;
}

/** One line on how a project is doing: the worst thing first. */
function summarizeHealth(stats: ProjectStats): ProjectHealth {
  if (stats.services === 0) return { tone: "neutral", pulse: false, label: "Aucun service" };
  if (stats.crashed > 0) {
    return { tone: "danger", pulse: false, label: `${stats.crashed} en erreur` };
  }
  if (stats.inProgress > 0) {
    return { tone: "info", pulse: true, label: `${stats.inProgress} en cours` };
  }
  if (stats.online === 0) return { tone: "neutral", pulse: false, label: "Arrêté" };
  return {
    tone: "success",
    pulse: false,
    label: stats.stopped > 0 ? `${stats.online} en ligne` : "En ligne",
  };
}

interface ProjectSwitcherProps {
  projectId: string;
  /** Switching keeps the user on the same kind of page. */
  page: "workspace" | "settings";
}

/** Breadcrumb entry of a project: its avatar and name, opening the list of all projects. */
export function ProjectSwitcher({ projectId, page }: ProjectSwitcherProps) {
  const { data: projects, isPending } = useProjects();
  const current = projects?.find((project) => project.id === projectId);

  if (isPending) {
    return (
      <div aria-busy="true" className="flex h-8 items-center gap-2 px-2">
        <Skeleton className="size-5 rounded-[5px]" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }

  const hrefFor = (id: string) =>
    page === "settings" ? routes.projectSettings(id) : routes.workspace(id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-full gap-2 px-2 font-medium">
          {current ? (
            <ProjectAvatar name={current.name} color={current.color} size="xs" />
          ) : (
            <FolderOpen className="text-muted-foreground" />
          )}
          <span className="min-w-0 truncate">{current?.name ?? "Projet introuvable"}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={12} className="w-72">
        <DropdownMenuLabel>Projets</DropdownMenuLabel>
        <DropdownMenuGroup>
          {(projects ?? []).map((project) => {
            const health = summarizeHealth(project.stats);
            const isCurrent = project.id === projectId;
            return (
              <DropdownMenuItem key={project.id} asChild>
                <Link
                  href={hrefFor(project.id)}
                  aria-current={isCurrent ? "true" : undefined}
                  className="gap-2.5 py-1.5"
                >
                  <ProjectAvatar name={project.name} color={project.color} size="sm" />
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate text-sm font-medium">{project.name}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <StatusDot tone={health.tone} pulse={health.pulse} />
                      <span className="truncate">
                        {project.stats.services > 0
                          ? `${health.label} · ${pluralize(project.stats.services, "service")}`
                          : health.label}
                      </span>
                    </span>
                  </span>
                  {isCurrent ? <Check className="text-muted-foreground" /> : null}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={routes.projects()}>
            <LayoutGrid />
            Tous les projets
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={routes.projects({ new: true })}>
            <Plus />
            Nouveau projet
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
