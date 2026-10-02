"use client";

import { useState, type ReactNode } from "react";
import { Rocket } from "lucide-react";
import { AnimatePresence } from "motion/react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import type { DeploymentFilter } from "@/lib/api/contract";
import { useDeployments } from "@/lib/queries";
import type { Deployment } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useDeploymentActions, type DeploymentActions } from "../hooks/use-deployment-actions";
import { useDeploymentLookups } from "../hooks/use-deployment-lookups";
import { groupDeploymentsByDay, matchesDeploymentSearch } from "../lib/deployment-utils";
import { DeploymentRow } from "./deployment-row";

/** Rows revealed per step in the grouped (full page) mode. */
const PAGE_SIZE = 25;
const DEFAULT_EMPTY_HINT = "Les déploiements apparaîtront ici dès qu’un service sera déployé.";

export interface DeploymentListProps {
  filter?: DeploymentFilter;
  /** Denser rows without the project/trigger columns (dashboard, panels). */
  compact?: boolean;
  /** Shown when the list is empty. */
  emptyHint?: string;
  className?: string;
  /** Extra text filter on the loaded rows: commit message, sha, image, service name. */
  search?: string;
  /** Full-page mode: rows grouped under day headings, revealed 25 at a time. */
  grouped?: boolean;
  /** Action of the empty state (e.g. "Réinitialiser les filtres"). */
  emptyAction?: ReactNode;
}

type Lookups = ReturnType<typeof useDeploymentLookups>;

interface RowGroupProps {
  label: string;
  items: Deployment[];
  compact: boolean;
  hideService: boolean;
  lookups: Lookups;
  actions: DeploymentActions;
}

function RowGroup({ label, items, compact, hideService, lookups, actions }: RowGroupProps) {
  return (
    <ul aria-label={label} className="relative divide-y overflow-hidden rounded-xl border bg-card">
      <AnimatePresence mode="popLayout">
        {items.map((deployment, index) => (
          <DeploymentRow
            key={deployment.id}
            deployment={deployment}
            service={lookups.serviceById.get(deployment.serviceId)}
            project={lookups.projectById.get(deployment.projectId)}
            compact={compact}
            hideService={hideService}
            index={index}
            actions={actions}
          />
        ))}
      </AnimatePresence>
    </ul>
  );
}

function DeploymentListSkeleton({ compact }: { compact: boolean }) {
  return (
    <ul
      aria-busy="true"
      aria-label="Chargement des déploiements"
      className="divide-y overflow-hidden rounded-xl border bg-card"
    >
      {Array.from({ length: compact ? 4 : 6 }, (_, index) => (
        <li
          key={index}
          className={cn(
            "flex items-start gap-3 px-3.5 sm:px-4",
            compact ? "py-2.5" : "py-3 @3xl:items-center @3xl:gap-4",
          )}
        >
          <Skeleton className={cn("shrink-0", compact ? "size-7 rounded-md" : "size-9 rounded-lg")} />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-3/5 max-w-md" />
            <Skeleton className="h-5 w-2/5 max-w-xs" />
            {compact ? null : <Skeleton className="h-3.5 w-1/2 max-w-48 @5xl:hidden" />}
          </div>
          {compact ? (
            <Skeleton className="hidden h-8 w-20 @md:block" />
          ) : (
            <>
              <Skeleton className="hidden h-8 w-44 @5xl:block" />
              <Skeleton className="hidden h-4 w-24 @3xl:block" />
              <Skeleton className="hidden h-4 w-24 @3xl:block" />
            </>
          )}
          <Skeleton className="size-7 shrink-0 rounded-lg" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Deployment history rows: status, commit or image, duration and row actions.
 * Fetches its own data, so it can be dropped anywhere (page, dashboard, panel).
 */
export function DeploymentList({
  filter,
  compact = false,
  emptyHint,
  className,
  search = "",
  grouped = false,
  emptyAction,
}: DeploymentListProps) {
  const query = useDeployments(filter);
  const lookups = useDeploymentLookups();
  const actions = useDeploymentActions();
  const now = useNow(60_000);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const hideService = Boolean(filter?.serviceId);
  const loaded = query.data ?? [];
  const matching = search.trim()
    ? loaded.filter((deployment) =>
        matchesDeploymentSearch(
          deployment,
          lookups.serviceById.get(deployment.serviceId)?.name ?? "",
          search,
        ),
      )
    : loaded;
  const visible = grouped ? matching.slice(0, limit) : matching;
  const hiddenCount = matching.length - visible.length;

  let body: ReactNode;
  if (query.isError && !query.data) {
    body = (
      <div className="rounded-xl border bg-card">
        <ErrorState
          compact
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </div>
    );
  } else if (query.isPending || lookups.isLoading) {
    body = <DeploymentListSkeleton compact={compact} />;
  } else if (matching.length === 0) {
    body = (
      <div className="rounded-xl border bg-card">
        <EmptyState
          compact
          icon={Rocket}
          title="Aucun déploiement"
          description={emptyHint ?? DEFAULT_EMPTY_HINT}
          action={emptyAction}
        />
      </div>
    );
  } else if (grouped) {
    body = (
      <div className="space-y-6">
        {groupDeploymentsByDay(visible, now).map((group) => (
          <div key={group.key} className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">{group.label}</h3>
            <RowGroup
              label={group.label}
              items={group.items}
              compact={compact}
              hideService={hideService}
              lookups={lookups}
              actions={actions}
            />
          </div>
        ))}
        {hiddenCount > 0 ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
            >
              Afficher plus ({hiddenCount})
            </Button>
          </div>
        ) : null}
      </div>
    );
  } else {
    body = (
      <RowGroup
        label="Déploiements"
        items={visible}
        compact={compact}
        hideService={hideService}
        lookups={lookups}
        actions={actions}
      />
    );
  }

  return (
    <div
      className={cn(
        "@container transition-opacity",
        query.isPlaceholderData && "opacity-60",
        className,
      )}
      aria-busy={query.isPlaceholderData || undefined}
    >
      {body}
      {actions.dialogs}
    </div>
  );
}
