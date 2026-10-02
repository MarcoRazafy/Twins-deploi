"use client";

import { useState } from "react";
import { Hourglass, Rows3, Terminal } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { isServiceBusy } from "@/lib/status";

import { DatabaseGate } from "./database-gate";
import { DataPanelSkeleton } from "./panel-skeletons";
import { SegmentedControl } from "./segmented-control";
import { SqlConsole } from "./sql-console";
import { TablesBrowser } from "./tables-browser";

type DataView = "tables" | "sql";

/** Table browser and read-only SQL console. */
export function DatabaseDataPanel({ databaseId }: { databaseId: string }) {
  const [view, setView] = useState<DataView>("tables");

  return (
    <DatabaseGate databaseId={databaseId} skeleton={<DataPanelSkeleton />}>
      {(database) =>
        // Being deployed or restarted: the server cannot be queried yet.
        isServiceBusy(database.status) ? (
          <EmptyState
            compact
            icon={Hourglass}
            title="Base en cours de démarrage"
            description="Les tables et la console SQL seront disponibles dès que la base sera en ligne."
          />
        ) : (
          // Sized by the width it is given (full page or ~700 px service panel).
          <div className="@container space-y-4">
            <SegmentedControl<DataView>
              label="Mode d’exploration des données"
              value={view}
              onValueChange={setView}
              className="w-full @sm:w-fit"
              options={[
                { value: "tables", label: "Tables", icon: Rows3 },
                { value: "sql", label: "Console SQL", icon: Terminal },
              ]}
            />
            {view === "tables" ? (
              <TablesBrowser databaseId={database.id} />
            ) : (
              <SqlConsole databaseId={database.id} />
            )}
          </div>
        )
      }
    </DatabaseGate>
  );
}
