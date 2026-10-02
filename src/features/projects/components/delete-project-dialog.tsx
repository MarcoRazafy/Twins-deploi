"use client";

import { Boxes, Database, Globe, Rocket, Variable, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/api/contract";
import { formatNumber } from "@/lib/format";
import { useDeleteProject, useProject } from "@/lib/queries";
import type { Project, ProjectStats } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface DeleteProjectDialogProps {
  /** Project to delete; the dialog renders nothing while null. */
  project: Pick<Project, "id" | "name"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

interface DestroyedRow {
  key: string;
  icon: LucideIcon;
  count: number;
  singular: string;
  plural: string;
}

function destroyedRows(stats: ProjectStats): DestroyedRow[] {
  return [
    {
      key: "services",
      icon: Boxes,
      // The databases are services too: counted once, on their own line.
      count: Math.max(stats.services - stats.databases, 0),
      singular: "service",
      plural: "services",
    },
    {
      key: "databases",
      icon: Database,
      count: stats.databases,
      singular: "base de données",
      plural: "bases de données",
    },
    { key: "domains", icon: Globe, count: stats.domains, singular: "domaine", plural: "domaines" },
    {
      key: "variables",
      icon: Variable,
      count: stats.variables,
      singular: "variable d’environnement",
      plural: "variables d’environnement",
    },
    {
      key: "deployments",
      icon: Rocket,
      count: stats.deployments,
      singular: "déploiement",
      plural: "déploiements",
    },
  ];
}

function DestroyedSummary({ stats, loading }: { stats?: ProjectStats; loading: boolean }) {
  if (!stats && !loading) return null;

  return (
    <div className="rounded-lg bg-secondary px-3 py-2.5">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Seront supprimés avec le projet
      </p>
      {stats ? (
        <ul className="grid gap-1.5 text-sm">
          {destroyedRows(stats).map(({ key, icon: Icon, count, singular, plural }) => (
            <li key={key} className="flex items-center gap-2">
              <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className={cn("tabular", count > 0 ? "font-medium" : "text-muted-foreground")}>
                {formatNumber(count)}
              </span>
              <span className="text-muted-foreground">{count > 1 ? plural : singular}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid gap-2.5" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-4 w-40" />
          ))}
        </div>
      )}
    </div>
  );
}

interface DeleteProjectConfirmProps extends DeleteProjectDialogProps {
  /** Real counts shown to the user. Without them the dialog still warns, in words. */
  stats?: ProjectStats;
  statsLoading?: boolean;
}

/**
 * The dialog itself, for callers that already hold the project summary (cards,
 * table rows, the settings page): no extra request to learn what is destroyed.
 */
export function DeleteProjectConfirm({
  project,
  open,
  onOpenChange,
  onDeleted,
  stats,
  statsLoading = false,
}: DeleteProjectConfirmProps) {
  const remove = useDeleteProject();

  if (!project) return null;

  function handleConfirm() {
    if (!project) return;
    remove.mutate(project.id, {
      onSuccess: () => {
        toast.success("Projet supprimé", {
          description: `« ${project.name} » et son contenu ont été supprimés.`,
        });
        onOpenChange(false);
        onDeleted?.();
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title="Supprimer le projet"
      description={
        <>
          Le projet <strong className="font-medium text-foreground">« {project.name} »</strong> et
          tout ce qu’il contient seront supprimés définitivement. Cette action est irréversible.
        </>
      }
      confirmLabel="Supprimer le projet"
      confirmText={project.name}
      loading={remove.isPending}
      onConfirm={handleConfirm}
    >
      <DestroyedSummary stats={stats} loading={statsLoading} />
    </ConfirmDialog>
  );
}

/**
 * Typed-name confirmation before deleting a project, with the real counts of
 * what disappears with it.
 */
export function DeleteProjectDialog(props: DeleteProjectDialogProps) {
  // The counts are only needed once the dialog is open.
  const detail = useProject(props.open && props.project ? props.project.id : null);

  return (
    <DeleteProjectConfirm
      {...props}
      stats={detail.data?.stats}
      statsLoading={detail.isLoading}
    />
  );
}
