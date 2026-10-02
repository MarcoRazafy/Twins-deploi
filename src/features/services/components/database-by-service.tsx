"use client";

import type { ReactNode } from "react";

import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useDatabaseByService } from "@/lib/queries";

interface DatabaseByServiceProps {
  serviceId: string;
  children: (databaseId: string) => ReactNode;
}

/** Resolves the database backing a PostgreSQL service before rendering its panel. */
export function DatabaseByService({ serviceId, children }: DatabaseByServiceProps) {
  const database = useDatabaseByService(serviceId);

  if (database.isError) {
    return (
      <ErrorState
        compact
        title="Base de données introuvable"
        error={database.error}
        onRetry={() => void database.refetch()}
      />
    );
  }
  if (!database.data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  return <>{children(database.data.id)}</>;
}
