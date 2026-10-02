"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FolderKanban, Plus, SearchX } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { FadeIn } from "@/components/shared/motion";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { useQueryParam } from "@/hooks/use-query-param";
import { pluralize } from "@/lib/format";
import { useProjects } from "@/lib/queries";

import { useProjectsViewMode } from "../hooks/use-projects-view-mode";
import { filterProjects, sortProjects, type ProjectSort } from "../lib/project-list";
import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectsGrid } from "./projects-grid";
import { ProjectsSkeleton } from "./projects-skeleton";
import { ProjectsTable } from "./projects-table";
import { ProjectsToolbar } from "./projects-toolbar";

/** /projects: every project of the platform, as cards or as a table. */
export function ProjectsView() {
  const projects = useProjects();
  // The server renders the loading state, so must the hydration pass: the query
  // cache may already hold data by then (another component fetched it first).
  const hydrated = useHydrated();
  const [view, setView] = useProjectsViewMode();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("recent");
  // The dialog is a function of the URL: `?new=1` opens it (entry point of the
  // quick-create menu and the command palette), closing removes the parameter.
  const [newParam, setNewParam] = useQueryParam("new");

  const all = hydrated ? projects.data : undefined;
  const visible = useMemo(
    () => (all ? sortProjects(filterProjects(all, query), sort) : []),
    [all, query, sort],
  );

  let content: ReactNode;
  if (!all) {
    content = hydrated && projects.isError ? (
      <ErrorState
        title="Impossible de charger les projets"
        error={projects.error}
        onRetry={() => void projects.refetch()}
      />
    ) : (
      <ProjectsSkeleton view={view} />
    );
  } else if (all.length === 0) {
    content = (
      <EmptyState
        icon={FolderKanban}
        title="Aucun projet"
        description="Créez votre premier projet pour déployer des applications, des bases PostgreSQL et des conteneurs."
        action={
          <Button variant="outline" onClick={() => setNewParam("1")}>
            <Plus data-icon="inline-start" />
            Créer un projet
          </Button>
        }
      />
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        icon={SearchX}
        title="Aucun résultat"
        description={`Aucun projet ne correspond à « ${query.trim()} ».`}
        action={
          <Button variant="outline" onClick={() => setQuery("")}>
            Réinitialiser la recherche
          </Button>
        }
      />
    );
  } else if (view === "grid") {
    content = <ProjectsGrid projects={visible} />;
  } else {
    content = (
      <FadeIn>
        <ProjectsTable projects={visible} total={all.length} />
      </FadeIn>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Projets"
        description="Un projet regroupe ses services, bases de données, domaines et variables dans un même workspace."
        actions={
          <Button className="max-sm:h-10" onClick={() => setNewParam("1")}>
            <Plus data-icon="inline-start" />
            Nouveau projet
          </Button>
        }
      />

      {all?.length === 0 ? null : (
        <ProjectsToolbar
          query={query}
          onQueryChange={setQuery}
          sort={sort}
          onSortChange={setSort}
          view={view}
          onViewChange={setView}
          disabled={!all}
        />
      )}

      {/* Announces the effect of a search to screen readers. */}
      <p role="status" className="sr-only">
        {all ? `${pluralize(visible.length, "projet")} affiché${visible.length > 1 ? "s" : ""}` : ""}
      </p>

      {/* Columns follow the width the page actually gets (the sidebar takes its share). */}
      <div className="@container">{content}</div>

      <CreateProjectDialog
        open={newParam === "1"}
        onOpenChange={(open) => setNewParam(open ? "1" : null)}
      />
    </PageContainer>
  );
}
