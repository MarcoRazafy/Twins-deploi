"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, DatabaseZap, Pencil, Plus, SearchX, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage } from "@/lib/api/contract";
import { formatKilobytes, formatNumber, pluralize } from "@/lib/format";
import { useDatabaseTableData, useDatabaseTables, useWriteDatabaseRow } from "@/lib/queries";
import type { DatabaseRow, DatabaseTable } from "@/lib/types";
import { cn } from "@/lib/utils";

import { TablesSkeleton } from "./panel-skeletons";
import { ResultGrid } from "./result-grid";
import { primaryKeyOf, RowEditorDialog } from "./row-editor-dialog";

const PAGE_SIZE = 25;

function TableList({
  tables,
  selected,
  onSelect,
}: {
  tables: DatabaseTable[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? tables.filter((table) => table.name.toLowerCase().includes(needle)) : tables;
  }, [tables, search]);

  return (
    <div className="space-y-2 rounded-xl border bg-card p-2 @max-xl:hidden">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Filtrer les tables"
        label="Filtrer les tables"
        className="w-full sm:w-full"
      />
      {visible.length === 0 ? (
        <p className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
          <SearchX className="size-4" aria-hidden="true" />
          Aucune table ne correspond.
        </p>
      ) : (
        <ul className="max-h-[26rem] space-y-0.5 overflow-y-auto">
          {visible.map((table) => {
            const active = table.name === selected;
            return (
              <li key={table.name}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(table.name)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50",
                    active && "bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "truncate font-mono text-[13px]",
                      active ? "text-foreground" : "text-foreground/90",
                    )}
                  >
                    {table.name}
                  </span>
                  <span className="tabular text-xs text-muted-foreground">
                    {pluralize(table.rowCount, "ligne")} · {formatKilobytes(table.sizeKb)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TableData({ databaseId, table }: { databaseId: string; table: DatabaseTable }) {
  const [offset, setOffset] = useState(0);
  const query = useDatabaseTableData(databaseId, table.name, { limit: PAGE_SIZE, offset });
  const { data } = query;
  const remove = useWriteDatabaseRow();
  /** undefined: closed; null: new row; a row: that row. */
  const [editing, setEditing] = useState<DatabaseRow | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<DatabaseRow | null>(null);
  const editable = table.columns.some((column) => column.primaryKey);

  function confirmDelete() {
    const key = deleting ? primaryKeyOf(table, deleting) : null;
    if (!key) return;
    remove.mutate(
      { kind: "delete", id: databaseId, table: table.name, key },
      {
        onSuccess: () => {
          toast.success("Ligne supprimée", { description: table.name });
          setDeleting(null);
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  const columns = data?.columns ?? table.columns;
  const total = data?.total ?? table.rowCount;
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-mono text-sm font-medium">
          {table.schema}.{table.name}
        </h3>
        <div className="flex items-center gap-3">
          <p className="tabular text-xs text-muted-foreground">
            {pluralize(total, "ligne")} · {pluralize(columns.length, "colonne")} ·{" "}
            {formatKilobytes(table.sizeKb)}
          </p>
          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
            <Plus data-icon="inline-start" />
            Ajouter une ligne
          </Button>
        </div>
      </div>
      {!editable ? (
        <p className="text-xs text-muted-foreground">
          Cette table n’a pas de clé primaire : modifiez ou supprimez ses lignes depuis la console SQL.
        </p>
      ) : null}

      {query.isError && !data ? (
        <ErrorState
          compact
          title="Impossible de charger les lignes"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : !data ? (
        <div aria-busy="true" className="space-y-1.5 rounded-lg border bg-card p-3">
          <p role="status" className="sr-only">
            Chargement des lignes…
          </p>
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      ) : (
        <div className={cn("transition-opacity", query.isPlaceholderData && "opacity-60")}>
          <ResultGrid
            columns={columns}
            rows={data.rows}
            label={`Lignes de la table ${table.name}`}
            emptyMessage="Cette table ne contient aucune ligne."
            rowActions={
              editable
                ? (row) => (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Modifier la ligne"
                        title="Modifier"
                        onClick={() => setEditing(row)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Supprimer la ligne"
                        title="Supprimer"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting(row)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )
                : undefined
            }
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="tabular text-xs text-muted-foreground" aria-live="polite">
          {formatNumber(first)}-{formatNumber(last)} sur {formatNumber(total)}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Page précédente"
            disabled={offset === 0}
            onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Page suivante"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((current) => current + PAGE_SIZE)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <RowEditorDialog
        databaseId={databaseId}
        table={table}
        row={editing ?? null}
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        tone="danger"
        title="Supprimer la ligne"
        description={
          <>
            Cette ligne de <span className="font-mono">{table.name}</span> sera supprimée définitivement.
          </>
        }
        loading={remove.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/** Table list on the left (a select above the grid when narrow) and the rows of the chosen table. */
export function TablesBrowser({ databaseId }: { databaseId: string }) {
  const tables = useDatabaseTables(databaseId);
  const [selected, setSelected] = useState<string | null>(null);

  if (tables.isPending) return <TablesSkeleton />;

  if (tables.isError) {
    return (
      <ErrorState
        compact
        title="Impossible de charger les tables"
        error={tables.error}
        onRetry={() => void tables.refetch()}
      />
    );
  }

  const list = tables.data;
  if (list.length === 0) {
    return (
      <EmptyState
        compact
        icon={DatabaseZap}
        title="Aucune table"
        description="Cette base est vide. Créez votre schéma avec des migrations (Prisma, Drizzle, Flyway…) lancées depuis votre service."
      />
    );
  }

  // The chosen table may vanish (database reset): fall back to the first one.
  const current = list.find((table) => table.name === selected) ?? list[0];

  return (
    <div className="grid gap-4 @xl:grid-cols-[15rem_minmax(0,1fr)] @xl:items-start">
      <div className="@xl:hidden">
        <Select value={current.name} onValueChange={setSelected}>
          <SelectTrigger aria-label="Table à afficher" className="w-full font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {list.map((table) => (
              <SelectItem key={table.name} value={table.name}>
                <span className="font-mono">{table.name}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {formatNumber(table.rowCount)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <TableList tables={list} selected={current.name} onSelect={setSelected} />
      <TableData key={current.name} databaseId={databaseId} table={current} />
    </div>
  );
}
