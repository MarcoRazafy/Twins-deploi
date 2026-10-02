"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Database as DatabaseIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { useDatabase } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { Database } from "@/lib/types";

import { isNotFoundError } from "../lib/database-utils";

export function DatabaseNotFound({ compact = false }: { compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      icon={DatabaseIcon}
      title="Base de données introuvable"
      description="Cette base n’existe pas ou a été supprimée."
      action={
        <Button asChild variant="outline">
          <Link href={routes.databases()}>Voir toutes les bases</Link>
        </Button>
      }
    />
  );
}

export interface DatabaseGateProps {
  databaseId: string;
  /** Placeholder shaped like the content, shown until the database is known. */
  skeleton: ReactNode;
  children: (database: Database) => ReactNode;
}

/**
 * Loads the database a panel works on and renders the loading, error and
 * not-found states, so every panel is self-contained wherever it is embedded.
 */
export function DatabaseGate({ databaseId, skeleton, children }: DatabaseGateProps) {
  // The server renders the skeleton, so must the hydration pass: the query
  // cache may already hold the database by then.
  const hydrated = useHydrated();
  const query = useDatabase(databaseId);
  const database = hydrated ? query.data : undefined;

  if (database) return <>{children(database)}</>;

  if (hydrated && query.isError) {
    return isNotFoundError(query.error) ? (
      <DatabaseNotFound compact />
    ) : (
      <ErrorState
        compact
        title="Impossible de charger la base"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return <>{skeleton}</>;
}
