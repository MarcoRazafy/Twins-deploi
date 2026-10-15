import type { ReactNode } from "react";
import { KeyRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DatabaseCell, DatabaseRow } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface GridColumn {
  name: string;
  /** SQL type shown under the name (tables only). */
  type?: string;
  primaryKey?: boolean;
}

export interface ResultGridProps {
  columns: GridColumn[];
  rows: DatabaseRow[];
  /** Accessible name of the table. */
  label: string;
  emptyMessage?: string;
  /** The grid scrolls (both ways) inside this height; the header stays visible. */
  maxHeight?: string;
  className?: string;
  /** Buttons of a last column kept visible on the right (edit, delete…). */
  rowActions?: (row: DatabaseRow) => ReactNode;
}

function Cell({ value }: { value: DatabaseCell | undefined }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/70 italic">NULL</span>;
  }
  if (typeof value === "boolean") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "font-mono",
          value
            ? "border-success/25 bg-success/10 text-success"
            : "bg-secondary text-muted-foreground",
        )}
      >
        {value ? "true" : "false"}
      </Badge>
    );
  }
  const text = String(value);
  return (
    <span
      title={text.length > 40 ? text : undefined}
      className={cn("block max-w-[22rem] truncate", typeof value === "number" && "tabular")}
    >
      {text}
    </span>
  );
}

/**
 * Data grid, with optional per-row actions: sticky header, monospace cells, NULL dimmed, booleans
 * as badges. The scroll container is the grid itself, so the page never
 * scrolls sideways.
 */
export function ResultGrid({
  columns,
  rows,
  label,
  emptyMessage = "Aucune ligne à afficher.",
  maxHeight = "28rem",
  className,
  rowActions,
}: ResultGridProps) {
  return (
    <div
      className={cn("overflow-auto rounded-lg border bg-card", className)}
      style={{ maxHeight }}
      // A scrollable region must be reachable from the keyboard.
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table className="w-full min-w-max border-separate border-spacing-0 text-left font-mono text-[13px]">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.name}
                scope="col"
                className="sticky top-0 z-10 border-b bg-secondary px-3 py-2 font-medium whitespace-nowrap"
              >
                <span className="flex items-center gap-1.5">
                  {column.primaryKey ? (
                    <KeyRound
                      className="size-3 text-warning"
                      aria-label="Clé primaire"
                      role="img"
                    />
                  ) : null}
                  <span className="text-foreground">{column.name}</span>
                </span>
                {column.type ? (
                  <span className="block font-sans text-[11px] font-normal text-muted-foreground">
                    {column.type}
                  </span>
                ) : null}
              </th>
            ))}
            {rowActions ? (
              <th scope="col" className="sticky top-0 right-0 z-20 border-b bg-secondary px-2 py-2">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={Math.max(1, columns.length + (rowActions ? 1 : 0))}
                className="px-3 py-8 text-center font-sans text-sm text-muted-foreground"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-accent/40">
                {columns.map((column) => (
                  <td
                    key={column.name}
                    className="border-b border-border/60 px-3 py-1.5 whitespace-nowrap"
                  >
                    <Cell value={row[column.name]} />
                  </td>
                ))}
                {rowActions ? (
                  <td className="sticky right-0 border-b border-border/60 bg-card px-1.5 py-0.5 whitespace-nowrap">
                    <span className="flex items-center justify-end gap-0.5">{rowActions(row)}</span>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
