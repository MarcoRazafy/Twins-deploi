"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FileCode, KeyRound, Plus, SearchX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { TableShell } from "@/components/shared/table-shell";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api/contract";
import { pluralize } from "@/lib/format";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { useServices, useVariables } from "@/lib/queries";
import type { EnvVariable } from "@/lib/types";
import { cn } from "@/lib/utils";

import { pendingScopeKey, usePendingChanges, useVariableActions } from "../hooks/use-variable-actions";
import { buildReferenceSuggestions, serializeEnv } from "../lib/env";
import { ChangesBanner, VariableSuggestions } from "./editor-notices";
import { InheritedVariables } from "./inherited-variables";
import { RawEditorDialog } from "./raw-editor-dialog";
import { VariableForm } from "./variable-form";
import { VariablesSkeleton, VariablesTable } from "./variables-table";
import { VariablesToolbar } from "./variables-toolbar";

export interface VariablesEditorProps {
  projectId: string;
  /** null = shared (project-level) variables. */
  serviceId: string | null;
  className?: string;
  /** Opens the "Nouvelle variable" form on first render (the `?new=1` entry point). */
  defaultFormOpen?: boolean;
}

const LAYOUT_MOTION = { layout: "position", transition: { layout: SPRING.smooth } } as const;

function ScopedEditor({ projectId, serviceId, className, defaultFormOpen = false }: VariablesEditorProps) {
  const isService = serviceId !== null;
  const variablesQuery = useVariables({ projectId, serviceId });
  // Only a service has something to inherit or to be suggested.
  const sharedQuery = useVariables({ projectId, serviceId: null }, { enabled: isService });
  const servicesQuery = useServices({ projectId }, { enabled: isService });
  const actions = useVariableActions({ projectId, serviceId });

  const scopeKey = pendingScopeKey(projectId, serviceId);
  const hasPendingChanges = usePendingChanges((state) => state.scopes[scopeKey] === true);
  const clearPending = usePendingChanges((state) => state.clear);

  const [search, setSearch] = useState("");
  const [revealAll, setRevealAll] = useState(false);
  const [formOpen, setFormOpen] = useState(defaultFormOpen);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  // The target outlives the dialog's closing animation, hence two states.
  const [deleteTarget, setDeleteTarget] = useState<EnvVariable | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const variables = variablesQuery.data;
  const query = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!variables) return [];
    if (!query) return variables;
    return variables.filter(
      (variable) =>
        variable.key.toLowerCase().includes(query) ||
        // Sealed values are never searched: a match would leak them.
        (!variable.isSecret && variable.value.toLowerCase().includes(query)),
    );
  }, [variables, query]);

  const existingKeys = useMemo(
    () => new Set((variables ?? []).map((variable) => variable.key)),
    [variables],
  );
  const envText = useMemo(() => (variables ? serializeEnv(variables) : ""), [variables]);
  const secretCount = useMemo(
    () => (variables ?? []).filter((variable) => variable.isSecret).length,
    [variables],
  );

  const suggestions = useMemo(() => {
    if (!serviceId || !servicesQuery.data || !variables || !sharedQuery.data) return [];
    return buildReferenceSuggestions({
      serviceId,
      services: servicesQuery.data,
      own: variables,
      shared: sharedQuery.data,
    });
  }, [serviceId, servicesQuery.data, variables, sharedQuery.data]);

  const serviceName = servicesQuery.data?.find((service) => service.id === serviceId)?.name;
  // Completes "… sera supprimée ___" and "… les variables ___".
  const scopeLabel = isService
    ? serviceName
      ? `du service ${serviceName}`
      : "de ce service"
    : "partagées du projet";

  function openForm() {
    setEditingId(null);
    setFormOpen(true);
  }

  function startEdit(variable: EnvVariable) {
    setFormOpen(false);
    setEditingId(variable.id);
  }

  function requestDelete(variable: EnvVariable) {
    setDeleteTarget(variable);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await actions.remove(deleteTarget);
      setDeleteOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  let content: ReactNode;
  if (variablesQuery.isPending) {
    content = <VariablesSkeleton />;
  } else if (!variables) {
    content = (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5">
        <ErrorState
          compact
          title="Impossible de charger les variables"
          error={variablesQuery.error}
          onRetry={() => void variablesQuery.refetch()}
        />
      </div>
    );
  } else if (variables.length === 0) {
    content = formOpen ? (
      <div className="overflow-hidden rounded-xl border bg-card">
        <VariableForm
          existingKeys={existingKeys}
          actions={actions}
          onClose={() => setFormOpen(false)}
        />
      </div>
    ) : (
      <EmptyState
        icon={KeyRound}
        title="Aucune variable"
        description={
          isService
            ? "Ajoutez les variables d’environnement dont ce service a besoin au démarrage."
            : "Les variables partagées sont disponibles pour tous les services du projet."
        }
        action={
          <Button type="button" onClick={openForm}>
            <Plus data-icon="inline-start" />
            Nouvelle variable
          </Button>
        }
        secondaryAction={
          <Button type="button" variant="outline" onClick={() => setRawOpen(true)}>
            <FileCode data-icon="inline-start" />
            Coller un .env
          </Button>
        }
      />
    );
  } else {
    content = (
      <TableShell
        toolbar={
          <VariablesToolbar
            search={search}
            onSearchChange={setSearch}
            revealAll={revealAll}
            onToggleReveal={() => setRevealAll((current) => !current)}
            hasSecrets={secretCount > 0}
            envText={envText}
            formOpen={formOpen}
            onNew={openForm}
            onOpenRaw={() => setRawOpen(true)}
          />
        }
        footer={
          <span className="tabular">
            {query
              ? `${filtered.length} sur ${pluralize(variables.length, "variable")}`
              : pluralize(variables.length, "variable")}
            {secretCount > 0 ? ` · ${pluralize(secretCount, "secret")}` : ""}
          </span>
        }
      >
        <AnimatePresence initial={false}>
          {formOpen ? (
            <motion.div
              key="add-form"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
              exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE.out } }}
              className="border-b bg-secondary/30"
            >
              <VariableForm
                existingKeys={existingKeys}
                actions={actions}
                onClose={() => setFormOpen(false)}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
        {filtered.length > 0 ? (
          <VariablesTable
            variables={filtered}
            revealAll={revealAll}
            editingId={editingId}
            existingKeys={existingKeys}
            actions={actions}
            onEdit={startEdit}
            onCloseEdit={() => setEditingId(null)}
            onDelete={requestDelete}
          />
        ) : (
          <EmptyState
            compact
            icon={SearchX}
            title="Aucun résultat"
            description={`Aucune variable ne correspond à « ${search.trim()} ».`}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setSearch("")}>
                Effacer la recherche
              </Button>
            }
          />
        )}
      </TableShell>
    );
  }

  return (
    <div className={cn("@container flex w-full flex-col gap-4", className)}>
      <AnimatePresence initial={false}>
        {hasPendingChanges ? (
          <ChangesBanner
            key="changes-banner"
            serviceId={serviceId}
            serviceName={serviceName}
            onDismiss={() => clearPending(scopeKey)}
          />
        ) : null}
        {suggestions.length > 0 ? (
          <VariableSuggestions key="suggestions" suggestions={suggestions} actions={actions} />
        ) : null}
      </AnimatePresence>

      <motion.div {...LAYOUT_MOTION}>{content}</motion.div>

      {isService ? (
        <motion.div {...LAYOUT_MOTION}>
          <InheritedVariables projectId={projectId} overriddenKeys={existingKeys} />
        </motion.div>
      ) : null}

      <RawEditorDialog
        open={rawOpen}
        onOpenChange={setRawOpen}
        variables={variables ?? []}
        scopeLabel={scopeLabel}
        actions={actions}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title="Supprimer la variable"
        description={
          <>
            La variable{" "}
            <span className="font-mono text-[13px] font-medium text-foreground">
              {deleteTarget?.key}
            </span>{" "}
            sera supprimée {isService ? scopeLabel : "des variables partagées"}.
            {isService
              ? " Le service la perdra au prochain déploiement."
              : " Les services du projet la perdront au prochain déploiement."}
          </>
        }
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/**
 * Full editor of one scope: searchable list with masked secrets, inline add and
 * edit, delete with confirmation, raw `.env` editor, and, for a service, the
 * inherited shared variables and reference suggestions. Fluid and self-contained
 * (no page header): it adapts to the width of its container, so it works as a
 * page column and inside the service panel alike.
 */
export function VariablesEditor(props: VariablesEditorProps) {
  // A different scope starts clean: search, open forms and dialogs reset.
  return <ScopedEditor key={`${props.projectId}:${props.serviceId ?? "shared"}`} {...props} />;
}
