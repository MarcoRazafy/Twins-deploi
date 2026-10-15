"use client";

import { useId, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getErrorMessage } from "@/lib/api/contract";
import { useWriteDatabaseRow } from "@/lib/queries";
import type { DatabaseCell, DatabaseColumn, DatabaseRow, DatabaseTable } from "@/lib/types";

import { SubmitButton } from "./submit-button";

/** "value": the text typed; "null": NULL; "default": left out of the INSERT (column default). */
type FieldMode = "value" | "null" | "default";

interface FieldDraft {
  mode: FieldMode;
  text: string;
}

const MODE_LABELS: Record<FieldMode, string> = {
  value: "Valeur",
  null: "NULL",
  default: "Par défaut",
};

function textOf(value: DatabaseCell | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function initialDraft(columns: DatabaseColumn[], row: DatabaseRow | null): Record<string, FieldDraft> {
  return Object.fromEntries(
    columns.map((column) => {
      if (!row) return [column.name, { mode: "default", text: "" }];
      const value = row[column.name];
      return [column.name, { mode: value === null ? "null" : "value", text: textOf(value) }];
    }),
  );
}

/** The whole primary key of a displayed row, null when the table has none. */
export function primaryKeyOf(table: DatabaseTable, row: DatabaseRow): DatabaseRow | null {
  const keyColumns = table.columns.filter((column) => column.primaryKey);
  if (keyColumns.length === 0) return null;
  return Object.fromEntries(keyColumns.map((column) => [column.name, row[column.name] ?? null]));
}

export interface RowEditorDialogProps {
  databaseId: string;
  table: DatabaseTable;
  /** The row to edit; null inserts a new one. */
  row: DatabaseRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Inserts or updates one row. Values are typed as PostgreSQL text literals
 * (true, 42, 2026-01-31, {"a":1}…): the server converts them to the column type.
 * An update sends only the columns that changed.
 */
export function RowEditorDialog({ databaseId, table, row, open, onOpenChange }: RowEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {/* Remounted on every opening: the draft starts from the current row. */}
        {open ? (
          <RowEditorForm databaseId={databaseId} table={table} row={row} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RowEditorForm({
  databaseId,
  table,
  row,
  onDone,
}: {
  databaseId: string;
  table: DatabaseTable;
  row: DatabaseRow | null;
  onDone: () => void;
}) {
  const ids = useId();
  const write = useWriteDatabaseRow();
  const editing = row !== null;
  const [initial] = useState(() => initialDraft(table.columns, row));
  const [draft, setDraft] = useState(initial);

  const setField = (name: string, patch: Partial<FieldDraft>) =>
    setDraft((current) => ({ ...current, [name]: { ...current[name], ...patch } }));

  function collect(): DatabaseRow {
    const values: DatabaseRow = {};
    for (const column of table.columns) {
      const field = draft[column.name];
      if (field.mode === "default") continue;
      if (editing) {
        const before = initial[column.name];
        if (before.mode === field.mode && (field.mode === "null" || before.text === field.text)) continue;
      }
      values[column.name] = field.mode === "null" ? null : field.text;
    }
    return values;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (write.isPending) return;
    const values = collect();
    if (editing) {
      const key = primaryKeyOf(table, row);
      if (!key) return;
      if (Object.keys(values).length === 0) {
        onDone();
        return;
      }
      write.mutate(
        { kind: "update", id: databaseId, table: table.name, key, values },
        {
          onSuccess: () => {
            toast.success("Ligne modifiée", { description: table.name });
            onDone();
          },
        },
      );
    } else {
      write.mutate(
        { kind: "insert", id: databaseId, table: table.name, values },
        {
          onSuccess: () => {
            toast.success("Ligne ajoutée", { description: table.name });
            onDone();
          },
        },
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? "Modifier la ligne" : "Ajouter une ligne"}</DialogTitle>
        <DialogDescription>
          Table <span className="font-mono">{table.schema}.{table.name}</span>. Saisissez les valeurs
          comme en SQL (true, 42, 2026-01-31, {"{"}&quot;a&quot;:1{"}"}…).
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-3">
        {table.columns.map((column) => {
          const field = draft[column.name];
          const inputId = `${ids}-${column.name}`;
          const modes: FieldMode[] = ["value"];
          if (column.nullable) modes.push("null");
          if (!editing) modes.push("default");
          return (
            <Field key={column.name} className="gap-1.5">
              <FieldLabel htmlFor={inputId} className="flex items-center gap-1.5">
                {column.primaryKey ? (
                  <KeyRound className="size-3 text-warning" aria-label="Clé primaire" role="img" />
                ) : null}
                <span className="font-mono text-[13px]">{column.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{column.type}</span>
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  id={inputId}
                  value={field.mode === "value" ? field.text : ""}
                  placeholder={field.mode === "value" ? "" : MODE_LABELS[field.mode]}
                  onChange={(event) => setField(column.name, { mode: "value", text: event.target.value })}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 font-mono text-[13px] md:text-[13px]"
                />
                {modes.length > 1 ? (
                  <Select
                    value={field.mode}
                    onValueChange={(mode) => setField(column.name, { mode: mode as FieldMode })}
                  >
                    <SelectTrigger aria-label={`Type de valeur pour ${column.name}`} className="w-32 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modes.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {MODE_LABELS[mode]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            </Field>
          );
        })}
      </FieldGroup>

      {write.isError ? <FieldError role="alert">{getErrorMessage(write.error)}</FieldError> : null}

      <DialogFooter>
        <Button type="button" variant="outline" className="max-sm:h-10" onClick={onDone} disabled={write.isPending}>
          Annuler
        </Button>
        <SubmitButton pending={write.isPending}>{editing ? "Enregistrer" : "Ajouter"}</SubmitButton>
      </DialogFooter>
    </form>
  );
}
