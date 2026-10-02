"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ProjectAvatar } from "@/components/shared/project-avatar";
import { RelativeTime } from "@/components/shared/relative-time";
import { TableShell } from "@/components/shared/table-shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { REGION_LABELS } from "@/lib/constants";
import { pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { ProjectSummary } from "@/lib/types";

import { regionCity } from "../lib/project-list";
import { ProjectActionsMenu } from "./project-actions-menu";
import { ProjectHealthBadge } from "./project-status";

// Secondary columns drop out as the container narrows (DESIGN.md §5). The
// thresholds are widths of the content area, not of the window: the sidebar
// takes 240 px of it, so the window breakpoints would overflow the table.
export const PROJECT_COLUMNS = {
  status: "hidden @2xl:table-cell",
  services: "hidden @4xl:table-cell",
  lastDeployment: "hidden @4xl:table-cell",
  domains: "hidden @[1060px]:table-cell",
  region: "hidden @[1060px]:table-cell",
} as const;

export function ProjectsTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Projet</TableHead>
        <TableHead className={PROJECT_COLUMNS.services}>Services</TableHead>
        <TableHead className={PROJECT_COLUMNS.status}>Statut</TableHead>
        <TableHead className={PROJECT_COLUMNS.domains}>Domaines</TableHead>
        <TableHead className={PROJECT_COLUMNS.lastDeployment}>Dernier déploiement</TableHead>
        <TableHead className={PROJECT_COLUMNS.region}>Région</TableHead>
        <TableHead className="w-16">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  const router = useRouter();
  const href = routes.workspace(project.id);

  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(href)}>
      <TableCell>
        <div className="flex items-center gap-3">
          <ProjectAvatar name={project.name} color={project.color} size="md" />
          <div className="min-w-0">
            {/* The link keeps the row reachable and announced; a click anywhere
                else on the row navigates too. */}
            <Link
              href={href}
              title={project.name}
              onClick={(event) => event.stopPropagation()}
              className="block max-w-56 truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-72"
            >
              {project.name}
            </Link>
            <p className="hidden max-w-72 truncate text-xs text-muted-foreground @2xl:block">
              {project.description || "Aucune description"}
            </p>
            <ProjectHealthBadge stats={project.stats} className="text-xs @2xl:hidden" />
          </div>
        </div>
      </TableCell>
      <TableCell className={`${PROJECT_COLUMNS.services} text-muted-foreground tabular`}>
        {pluralize(project.stats.services, "service")}
      </TableCell>
      <TableCell className={PROJECT_COLUMNS.status}>
        <ProjectHealthBadge stats={project.stats} />
      </TableCell>
      <TableCell className={`${PROJECT_COLUMNS.domains} text-muted-foreground tabular`}>
        {project.stats.domains}
      </TableCell>
      <TableCell className={`${PROJECT_COLUMNS.lastDeployment} text-muted-foreground`}>
        <RelativeTime date={project.lastDeployment?.createdAt} fallback="Jamais déployé" />
      </TableCell>
      <TableCell
        className={`${PROJECT_COLUMNS.region} text-muted-foreground`}
        title={REGION_LABELS[project.region]}
      >
        {regionCity(project.region)}
      </TableCell>
      {/* Stops the bubbling of the React tree: the dialogs of the menu are
          portalled, yet their clicks would still reach the row handler. */}
      <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
        <ProjectActionsMenu project={project} />
      </TableCell>
    </TableRow>
  );
}

interface ProjectsTableProps {
  projects: readonly ProjectSummary[];
  /** Number of projects before the search filter, for the footer count. */
  total: number;
}

export function ProjectsTable({ projects, total }: ProjectsTableProps) {
  return (
    <TableShell
      footer={
        <span className="tabular">
          {projects.length < total
            ? `${projects.length} sur ${pluralize(total, "projet")}`
            : pluralize(total, "projet")}
        </span>
      }
    >
      <Table>
        <ProjectsTableHeader />
        <TableBody>
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}
