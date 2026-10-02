"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { Database as DatabaseIcon, Plus, SearchX } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { ProjectSelect } from "@/components/shared/project-select";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated } from "@/hooks/use-hydrated";
import { useQueryParam } from "@/hooks/use-query-param";
import { pluralize } from "@/lib/format";
import { useDatabases, useProjects } from "@/lib/queries";
import type { Database } from "@/lib/types";

import { CreateDatabaseDialog } from "./create-database-dialog";
import { DatabaseCard } from "./database-card";
import { DeleteDatabaseDialog } from "./delete-database-dialog";

const GRID_CLASSES = "grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3";

function DatabasesSkeleton() {
  return (
    <div aria-busy="true" className={GRID_CLASSES}>
      <p role="status" className="sr-only">
        Chargement des bases de données…
      </p>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

/** /databases: every PostgreSQL database of the platform. */
export function DatabasesView() {
  // The server renders the loading state, so must the hydration pass.
  const hydrated = useHydrated();
  const [projectId, setProjectId] = useQueryParam("project");
  // `?new=1` (quick-create menu, command palette) opens the dialog.
  const [newParam, setNewParam] = useQueryParam("new");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Database | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const projects = useProjects();
  const databases = useDatabases(projectId ? { projectId } : undefined);

  const projectsById = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );

  const all = hydrated ? databases.data : undefined;
  const visible = useMemo(() => {
    if (!all) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (database) =>
        database.name.toLowerCase().includes(needle) ||
        (projectsById.get(database.projectId)?.name.toLowerCase().includes(needle) ?? false),
    );
  }, [all, query, projectsById]);

  const openCreate = () => setNewParam("1");

  let content: ReactNode;
  if (!all) {
    content =
      hydrated && databases.isError ? (
        <ErrorState
          title="Impossible de charger les bases de données"
          error={databases.error}
          onRetry={() => void databases.refetch()}
        />
      ) : (
        <DatabasesSkeleton />
      );
  } else if (all.length === 0) {
    content = (
      <EmptyState
        icon={DatabaseIcon}
        title={projectId ? "Aucune base dans ce projet" : "Aucune base de données"}
        description="Créez une base PostgreSQL en quelques secondes, puis connectez-la à vos services avec une variable de référence."
        action={
          <Button onClick={openCreate}>
            <Plus data-icon="inline-start" />
            Nouvelle base
          </Button>
        }
        secondaryAction={
          projectId ? (
            <Button variant="outline" onClick={() => setProjectId(null)}>
              Tous les projets
            </Button>
          ) : undefined
        }
      />
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        icon={SearchX}
        title="Aucun résultat"
        description={`Aucune base ne correspond à « ${query.trim()} ».`}
        action={
          <Button variant="outline" onClick={() => setQuery("")}>
            Réinitialiser la recherche
          </Button>
        }
      />
    );
  } else {
    content = (
      <div className={GRID_CLASSES}>
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((database, index) => (
            <DatabaseCard
              key={database.id}
              database={database}
              project={projectsById.get(database.projectId)}
              index={index}
              onDelete={(target) => {
                setDeleteTarget(target);
                setDeleteOpen(true);
              }}
            />
          ))}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="PostgreSQL"
        description="Bases de données PostgreSQL gérées : créez-les, explorez leurs données, sauvegardez-les et connectez-les à vos services."
        actions={
          <Button className="max-sm:h-10" onClick={openCreate}>
            <Plus data-icon="inline-start" />
            Nouvelle base
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Rechercher une base"
          shortcut="/"
          disabled={!all}
        />
        <ProjectSelect
          allowAll
          value={projectId}
          onChange={setProjectId}
          aria-label="Filtrer par projet"
          className="w-full sm:w-52"
        />
      </div>

      <p role="status" className="sr-only">
        {all ? `${pluralize(visible.length, "base")} affichée${visible.length > 1 ? "s" : ""}` : ""}
      </p>

      {/* Columns follow the width the page actually gets (the sidebar takes its share). */}
      <div className="@container">{content}</div>

      <CreateDatabaseDialog
        open={newParam === "1"}
        onOpenChange={(open) => setNewParam(open ? "1" : null)}
        defaultProjectId={projectId ?? undefined}
      />
      {deleteTarget ? (
        <DeleteDatabaseDialog
          database={deleteTarget}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      ) : null}
    </PageContainer>
  );
}
