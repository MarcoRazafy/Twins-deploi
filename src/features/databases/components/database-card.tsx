"use client";

import Link from "next/link";
import { useId } from "react";
import { motion } from "motion/react";
import { Ellipsis, ExternalLink, Globe, Link2, Plug, Trash2, Waypoints } from "lucide-react";
import { toast } from "sonner";

import { ProgressBar } from "@/components/shared/progress-bar";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { RelativeTime } from "@/components/shared/relative-time";
import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { DURATION, EASE, STAGGER, hoverLift } from "@/lib/motion";
import { routes } from "@/lib/routes";
import type { Database, ProjectSummary } from "@/lib/types";

import { formatStorage, storagePercent, storageTone } from "../lib/database-utils";

export interface DatabaseCardProps {
  database: Database;
  project: ProjectSummary | undefined;
  /** Position in the grid: drives the entrance stagger. */
  index: number;
  onDelete: (database: Database) => void;
}

/** Clickable tile of a database (links to its detail page). */
export function DatabaseCard({ database, project, index, onDelete }: DatabaseCardProps) {
  const nameId = useId();
  const { copy } = useCopyToClipboard();
  const percent = storagePercent(database);

  async function copyUrl() {
    const copied = await copy(database.internalUrl);
    if (copied) toast.success("URL de connexion copiée", { description: database.name });
    else toast.error("Impossible de copier dans le presse-papiers");
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: {
          duration: DURATION.base,
          ease: EASE.out,
          delay: Math.min(index, STAGGER.maxItems) * STAGGER.step,
        },
      }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: DURATION.fast, ease: EASE.out } }}
    >
      <motion.div
        {...hoverLift}
        className="group relative h-full rounded-xl border bg-card transition-colors hover:border-border-strong hover:bg-secondary/40"
      >
        {/* The link is the card; the menu is its sibling, so a click on "…" never
            navigates and no interactive element is nested in another. */}
        <Link
          href={routes.database(database.id)}
          aria-labelledby={nameId}
          className="flex h-full flex-col gap-4 rounded-xl p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
        >
          <div className="flex items-center gap-3 pr-10">
            <ServiceIcon type="postgres" tile="lg" />
            <div className="min-w-0">
              <h3 id={nameId} title={database.name} className="truncate text-base font-medium">
                {database.name}
              </h3>
              {project ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ProjectAvatar name={project.name} color={project.color} size="xs" />
                  <span className="truncate">{project.name}</span>
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">PostgreSQL {database.version}</Badge>
            <StatusBadge kind="service" status={database.status} />
            {database.publicNetworking ? (
              <Badge variant="outline" className="border-warning/25 bg-warning/10 text-warning">
                <Globe />
                Réseau public
              </Badge>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Stockage</span>
              <span className="tabular font-medium">{formatStorage(database)}</span>
            </div>
            <ProgressBar
              value={percent}
              tone={storageTone(percent)}
              label={`Stockage utilisé : ${Math.round(percent)} %`}
            />
          </div>

          <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Plug className="size-3.5" aria-hidden="true" />
              <span className="tabular">
                {database.connections} / {database.maxConnections}
              </span>
              <span className="sr-only">connexions</span>
            </span>
            <RelativeTime date={database.createdAt} prefix="Créée" />
          </div>
        </Link>

        {/* Non-modal: a modal menu and the dialog it opens fight over the page's
            pointer events and can leave the page unclickable once it closes. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions de ${database.name}`}
              className="absolute top-3 right-3 text-muted-foreground"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem asChild>
              <Link href={routes.database(database.id)}>
                <ExternalLink />
                Ouvrir
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyUrl()}>
              <Link2 />
              Copier l’URL de connexion
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={routes.workspace(database.projectId, { service: database.serviceId })}>
                <Waypoints />
                Ouvrir dans le workspace
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(database)}>
              <Trash2 />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </motion.div>
    </motion.article>
  );
}
