"use client";

import { toast } from "sonner";
import { create } from "zustand";

import type { UpdateVariableInput } from "@/lib/api/contract";
import { pluralize } from "@/lib/format";
import {
  useBulkUpsertVariables,
  useCreateVariable,
  useDeleteVariable,
  useUpdateVariable,
} from "@/lib/queries";
import type { EnvVariable } from "@/lib/types";

import { summarizeDiff, type EnvDiff } from "../lib/env";

// ─────────────────────────────────────────────────────────────────────────────
// "Applied at the next deployment" banner state
// ─────────────────────────────────────────────────────────────────────────────

interface PendingChangesState {
  /** Scopes that changed since the user last dismissed or redeployed. */
  scopes: Record<string, true>;
  mark: (scopeKey: string) => void;
  clear: (scopeKey: string) => void;
}

/**
 * Lives outside the editor so the banner survives a remount (switching tabs
 * in the service panel); a full page reload starts clean on purpose.
 */
export const usePendingChanges = create<PendingChangesState>((set) => ({
  scopes: {},
  mark: (scopeKey) =>
    set((state) =>
      state.scopes[scopeKey] ? state : { scopes: { ...state.scopes, [scopeKey]: true } },
    ),
  clear: (scopeKey) =>
    set((state) => {
      if (!state.scopes[scopeKey]) return state;
      const scopes = { ...state.scopes };
      delete scopes[scopeKey];
      return { scopes };
    }),
}));

export function pendingScopeKey(projectId: string, serviceId: string | null): string {
  return serviceId ? `service:${serviceId}` : `shared:${projectId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

export interface VariableScope {
  projectId: string;
  /** null = shared (project-level) variables. */
  serviceId: string | null;
}

export interface NewVariable {
  key: string;
  value: string;
  isSecret: boolean;
}

/**
 * Every write of the editor, with its success toast and the banner marking.
 * Each action rejects with the API error so the caller decides where it goes
 * (inline under a field, or a toast).
 */
export function useVariableActions({ projectId, serviceId }: VariableScope) {
  const scopeKey = pendingScopeKey(projectId, serviceId);
  const markPending = usePendingChanges((state) => state.mark);
  const { mutateAsync: createVariable } = useCreateVariable();
  const { mutateAsync: updateVariable } = useUpdateVariable();
  const { mutateAsync: deleteVariable } = useDeleteVariable();
  const { mutateAsync: bulkUpsert } = useBulkUpsertVariables();

  return {
    async create(input: NewVariable) {
      const variable = await createVariable({ projectId, serviceId, ...input });
      markPending(scopeKey);
      toast.success("Variable ajoutée", { description: variable.key });
      return variable;
    },

    async update(variable: EnvVariable, patch: UpdateVariableInput) {
      await updateVariable({ id: variable.id, patch });
      // Sealing a value changes how it is displayed, not what the service receives.
      if (patch.key !== undefined || patch.value !== undefined) markPending(scopeKey);
      toast.success("Variable mise à jour", { description: patch.key ?? variable.key });
    },

    async toggleSecret(variable: EnvVariable) {
      const isSecret = !variable.isSecret;
      await updateVariable({ id: variable.id, patch: { isSecret } });
      toast.success(
        isSecret ? `${variable.key} est désormais secrète` : `${variable.key} n’est plus secrète`,
      );
    },

    async remove(variable: EnvVariable) {
      await deleteVariable(variable.id);
      markPending(scopeKey);
      toast.success("Variable supprimée", { description: variable.key });
    },

    /** Adds the entries and overwrites the ones that already exist; removes nothing. */
    async importEntries(entries: ReadonlyArray<{ key: string; value: string }>) {
      await bulkUpsert({ projectId, serviceId, entries: [...entries] });
      markPending(scopeKey);
      toast.success(
        entries.length > 1
          ? `${pluralize(entries.length, "variable")} importées`
          : "Variable importée",
      );
    },

    /** The raw editor: the scope becomes exactly `entries`. */
    async applyEntries(entries: Array<{ key: string; value: string }>, diff: EnvDiff) {
      await bulkUpsert({ projectId, serviceId, entries, replace: true });
      markPending(scopeKey);
      toast.success("Variables mises à jour", { description: summarizeDiff(diff) });
    },
  };
}

export type VariableActions = ReturnType<typeof useVariableActions>;
