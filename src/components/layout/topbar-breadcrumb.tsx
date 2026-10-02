"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { resolveRouteContext, type RouteContext } from "@/components/layout/nav-config";
import { ProjectSwitcher } from "@/components/layout/project-switcher";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDatabase, useDeployment, useService } from "@/lib/queries";
import { cn } from "@/lib/utils";

type DetailContext = Extract<RouteContext, { kind: "detail" }>;

/**
 * Short, readable form of a record id. Generated ids are one hex token
 * ("dep_9fa3c1b2d4" → "9fa3c1b"); the demo data uses readable ids that end
 * with a counter ("dep_observatoire_n8n_01" → "01").
 */
function shortId(id: string): string {
  const segments = id.split("_");
  const token = segments.length > 2 ? segments.at(-1) : segments[1];
  return (token ?? id).slice(0, 7);
}

function CrumbSeparator({ className }: { className?: string }) {
  return (
    <li aria-hidden="true" className={cn("shrink-0 text-subtle select-none", className)}>
      /
    </li>
  );
}

function DatabaseName({ id }: { id: string }) {
  const { data: database, isPending } = useDatabase(id);
  if (isPending) return <Skeleton className="h-4 w-28" />;
  return (
    <span className="block truncate font-medium text-foreground">
      {database?.name ?? shortId(id)}
    </span>
  );
}

function DeploymentName({ id }: { id: string }) {
  const { data: deployment, isPending } = useDeployment(id);
  // A null id keeps the query idle, so `isLoading` is only true while it really loads.
  const { data: service, isLoading: serviceLoading } = useService(deployment?.serviceId);
  if (isPending || serviceLoading) return <Skeleton className="h-4 w-36" />;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {service ? (
        <span className="truncate font-medium text-foreground">{service.name}</span>
      ) : null}
      <span
        className={cn(
          "shrink-0 font-mono text-xs",
          service ? "text-muted-foreground" : "font-medium text-foreground",
        )}
      >
        #{shortId(id)}
      </span>
    </span>
  );
}

function ProjectCrumbs({ projectId, page }: { projectId: string; page: "workspace" | "settings" }) {
  return (
    <>
      <li className="min-w-0">
        <ProjectSwitcher projectId={projectId} page={page} />
      </li>
      <CrumbSeparator className="max-sm:hidden" />
      {/* One environment in v1: a static badge, hidden on phones to keep room for the name. */}
      <li className="shrink-0 max-sm:hidden">
        <Badge variant="outline" className="rounded-md px-1.5 font-normal text-muted-foreground">
          production
        </Badge>
      </li>
      {page === "settings" ? (
        <>
          <CrumbSeparator />
          <li aria-current="page" className="shrink-0 font-medium text-foreground">
            Réglages
          </li>
        </>
      ) : null}
    </>
  );
}

function DetailCrumbs({ context }: { context: DetailContext }) {
  return (
    <>
      <li className="shrink-0 max-sm:hidden">
        <Link
          href={context.parent.href}
          className="rounded-md px-1 py-0.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {context.parent.label}
        </Link>
      </li>
      <CrumbSeparator className="max-sm:hidden" />
      <li aria-current="page" className="min-w-0">
        {context.entity === "database" ? (
          <DatabaseName id={context.id} />
        ) : (
          <DeploymentName id={context.id} />
        )}
      </li>
    </>
  );
}

/** Contextual trail of the top bar: page title, project switcher or parent link + entity. */
export function TopbarBreadcrumb() {
  const pathname = usePathname();
  const context = resolveRouteContext(pathname);

  return (
    <nav aria-label="Fil d’Ariane" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-2 text-sm">
        {context.kind === "page" ? (
          <li aria-current="page" className="truncate px-1 font-medium text-foreground">
            {context.title}
          </li>
        ) : context.kind === "project" ? (
          <ProjectCrumbs projectId={context.projectId} page={context.page} />
        ) : (
          <DetailCrumbs context={context} />
        )}
      </ol>
    </nav>
  );
}
