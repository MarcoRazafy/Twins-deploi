"use client";

import { Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DURATION, EASE } from "@/lib/motion";

import { createEnvRow, validateEnvKey, type EnvRow } from "../lib/image-reference";

export interface EnvVariableRowsProps {
  rows: EnvRow[];
  onRowsChange: (rows: EnvRow[]) => void;
  /** Error message by row id. */
  errors: Record<number, string>;
  onErrorsChange: (errors: Record<number, string>) => void;
  disabled?: boolean;
}

/** Dynamic key/value rows; keys are validated when the field loses focus. */
export function EnvVariableRows({
  rows,
  onRowsChange,
  errors,
  onErrorsChange,
  disabled,
}: EnvVariableRowsProps) {
  function patchRow(id: number, patch: Partial<EnvRow>) {
    onRowsChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function clearError(id: number) {
    if (errors[id] === undefined) return;
    const next = { ...errors };
    delete next[id];
    onErrorsChange(next);
  }

  function checkKey(row: EnvRow) {
    const key = row.key.trim();
    if (key === "") return;
    const message = validateEnvKey(key);
    if (message) onErrorsChange({ ...errors, [row.id]: message });
  }

  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {rows.map((row, index) => {
          const error = errors[row.id];
          return (
            <motion.div
              key={row.id}
              layout="position"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
              exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
              className="space-y-1"
            >
              <div className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    value={row.key}
                    placeholder="CLE"
                    aria-label={`Clé de la variable ${index + 1}`}
                    aria-invalid={error ? true : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                    className="font-mono text-[13px]"
                    onChange={(event) => {
                      patchRow(row.id, { key: event.target.value });
                      clearError(row.id);
                    }}
                    onBlur={() => checkKey(row)}
                  />
                  <Input
                    value={row.value}
                    placeholder="valeur"
                    aria-label={`Valeur de la variable ${index + 1}`}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                    className="font-mono text-[13px]"
                    onChange={(event) => patchRow(row.id, { value: event.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Retirer la variable ${index + 1}`}
                  disabled={disabled}
                  onClick={() => {
                    clearError(row.id);
                    onRowsChange(rows.filter((item) => item.id !== row.id));
                  }}
                >
                  <X />
                </Button>
              </div>
              <FieldError>{error}</FieldError>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onRowsChange([...rows, createEnvRow()])}
      >
        <Plus data-icon="inline-start" />
        Ajouter une variable
      </Button>
    </div>
  );
}
