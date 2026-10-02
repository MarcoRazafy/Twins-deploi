"use client";

import { useState } from "react";
import { Rows3, Terminal } from "lucide-react";

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
      {(database) => (
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
      )}
    </DatabaseGate>
  );
}
