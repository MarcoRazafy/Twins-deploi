import { TableShell } from "@/components/shared/table-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

import type { ProjectsViewMode } from "../hooks/use-projects-view-mode";
import { PROJECT_COLUMNS, ProjectsTableHeader } from "./projects-table";

// Same paddings, gaps and block heights as <ProjectCard>: nothing jumps when
// the data replaces the placeholder.
function ProjectCardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-3 pr-10">
        <Skeleton className="size-10 rounded-xl" />
        <Skeleton className="h-5 w-36" />
      </div>
      <div className="min-h-10 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="space-y-2.5">
        <div className="flex gap-1.5">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
        </div>
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}

function ProjectsTableSkeleton() {
  return (
    <TableShell>
      <Table>
        <ProjectsTableHeader />
        <TableBody>
          {Array.from({ length: 5 }, (_, index) => (
            <TableRow key={index} className="hover:bg-transparent">
              <TableCell>
                <div className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-lg" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-48 @max-2xl:w-28" />
                  </div>
                </div>
              </TableCell>
              <TableCell className={PROJECT_COLUMNS.services}>
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell className={PROJECT_COLUMNS.status}>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell className={PROJECT_COLUMNS.domains}>
                <Skeleton className="h-4 w-6" />
              </TableCell>
              <TableCell className={PROJECT_COLUMNS.lastDeployment}>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell className={PROJECT_COLUMNS.region}>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="ml-auto size-8 rounded-lg" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}

export function ProjectsSkeleton({ view }: { view: ProjectsViewMode }) {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Chargement des projets…
      </p>
      {view === "grid" ? (
        <div className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <ProjectCardSkeleton key={index} />
          ))}
        </div>
      ) : (
        <ProjectsTableSkeleton />
      )}
    </div>
  );
}
