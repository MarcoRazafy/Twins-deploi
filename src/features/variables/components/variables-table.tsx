"use client";

import { AnimatePresence, motion } from "motion/react";

import { TableShell } from "@/components/shared/table-shell";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DURATION, EASE } from "@/lib/motion";
import type { EnvVariable } from "@/lib/types";

import type { VariableActions } from "../hooks/use-variable-actions";
import { VariableForm } from "./variable-form";
import { VariableRow } from "./variable-row";

interface EditRowProps {
  variable: EnvVariable;
  existingKeys: ReadonlySet<string>;
  actions: VariableActions;
  onClose: () => void;
}

/** The row being edited: the form takes the place of the cells. */
function EditRow({ variable, existingKeys, actions, onClose }: EditRowProps) {
  return (
    <motion.tr
      layout="position"
      data-slot="table-row"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: DURATION.base, ease: EASE.out } }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE.out } }}
      className="border-b bg-secondary/30 hover:bg-secondary/30! @max-xl:grid @max-xl:grid-cols-[minmax(0,1fr)]"
    >
      <TableCell colSpan={4} className="p-0! @max-xl:col-span-full">
        <VariableForm
          variable={variable}
          existingKeys={existingKeys}
          actions={actions}
          onClose={onClose}
        />
      </TableCell>
    </motion.tr>
  );
}

export interface VariablesTableProps {
  variables: readonly EnvVariable[];
  revealAll: boolean;
  editingId: string | null;
  existingKeys: ReadonlySet<string>;
  actions: VariableActions;
  onEdit: (variable: EnvVariable) => void;
  onCloseEdit: () => void;
  onDelete: (variable: EnvVariable) => void;
}

/**
 * The list itself. It adapts to the width of its container rather than the
 * viewport (the editor lives in a 700 px panel as well as in a page column):
 * from `xl` it is a four-column table, below it each row is a two-line grid.
 */
export function VariablesTable({
  variables,
  revealAll,
  editingId,
  existingKeys,
  actions,
  onEdit,
  onCloseEdit,
  onDelete,
}: VariablesTableProps) {
  return (
    <Table className="table-fixed @max-xl:block">
      <TableHeader className="@max-xl:hidden">
        <TableRow>
          <TableHead className="w-[34%]">Variable</TableHead>
          <TableHead>Valeur</TableHead>
          <TableHead className="w-32">Mis à jour</TableHead>
          <TableHead className="w-14">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="@max-xl:block">
        <AnimatePresence>
          {variables.map((variable, index) =>
            variable.id === editingId ? (
              <EditRow
                key={variable.id}
                variable={variable}
                existingKeys={existingKeys}
                actions={actions}
                onClose={onCloseEdit}
              />
            ) : (
              <VariableRow
                key={variable.id}
                variable={variable}
                index={index}
                revealAll={revealAll}
                actions={actions}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ),
          )}
        </AnimatePresence>
      </TableBody>
    </Table>
  );
}

/** Same card, toolbar and row heights as the loaded list, so nothing jumps. */
export function VariablesSkeleton() {
  return (
    <TableShell
      toolbar={
        <>
          <Skeleton className="h-8 min-w-0 flex-1 basis-full rounded-lg @md:basis-40" />
          <Skeleton className="h-7 w-24 rounded-lg" />
          <Skeleton className="ml-auto h-7 w-36 rounded-lg" />
        </>
      }
    >
      <div aria-busy="true" aria-label="Chargement des variables" className="divide-y">
        {["w-32", "w-44", "w-28", "w-40", "w-36", "w-24"].map((width, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className={`h-4 ${width}`} />
            <Skeleton className="h-4 min-w-0 flex-1" />
            <Skeleton className="hidden h-4 w-20 @xl:block" />
            <Skeleton className="size-7 rounded-lg" />
          </div>
        ))}
      </div>
    </TableShell>
  );
}
