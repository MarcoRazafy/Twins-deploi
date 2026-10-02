"use client";

import { useId, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Archive, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ProgressBar } from "@/components/shared/progress-bar";
import { RelativeTime } from "@/components/shared/relative-time";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { formatDateTime, formatMegabytes, pluralize } from "@/lib/format";
import {
  useCreateBackup,
  useDatabaseBackups,
  useDeleteBackup,
  useRestoreBackup,
} from "@/lib/queries";
import { DURATION, EASE } from "@/lib/motion";
import type { Database, DatabaseBackup } from "@/lib/types";

import { DatabaseGate } from "./database-gate";
import { BackupsSkeleton } from "./panel-skeletons";
import { SubmitButton } from "./submit-button";

const MAX_LABEL_LENGTH = 80;

type BackupAction = { kind: "restore" | "delete"; backup: DatabaseBackup };

/** Backup list with create / restore / delete. */
export function DatabaseBackupsPanel({ databaseId }: { databaseId: string }) {
  return (
    <DatabaseGate databaseId={databaseId} skeleton={<BackupsSkeleton />}>
      {(database) => <BackupsContent database={database} />}
    </DatabaseGate>
  );
}

function CreateBackupDialog({
  database,
  open,
  onOpenChange,
}: {
  database: Database;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateBackup();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        {/* Unmounts with the content: each opening starts with an empty label. */}
        <CreateBackupForm
          database={database}
          create={create}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CreateBackupForm({
  database,
  create,
  onClose,
}: {
  database: Database;
  create: ReturnType<typeof useCreateBackup>;
  onClose: () => void;
}) {
  const id = useId();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
    const trimmed = label.trim();
    if (trimmed.length > MAX_LABEL_LENGTH) {
      setError(`Le libellé ne peut pas dépasser ${MAX_LABEL_LENGTH} caractères.`);
      return;
    }
    create.mutate(
      { databaseId: database.id, label: trimmed || undefined },
      {
        onSuccess: (backup) => {
          toast.success("Sauvegarde lancée", { description: backup.label });
          onClose();
        },
        onError: (apiError) => {
          if (isApiError(apiError) && apiError.field === "label") setError(apiError.message);
          else toast.error(getErrorMessage(apiError));
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Créer une sauvegarde</DialogTitle>
        <DialogDescription>
          Instantané complet de {database.name}, conservé jusqu’à sa suppression.
        </DialogDescription>
      </DialogHeader>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>Libellé (optionnel)</FieldLabel>
        <Input
          id={id}
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
            setError(null);
          }}
          placeholder="Avant la migration"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          disabled={create.isPending}
        />
        {error ? (
          <FieldError>{error}</FieldError>
        ) : (
          <FieldDescription>Sans libellé : « Sauvegarde manuelle ».</FieldDescription>
        )}
      </Field>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="max-sm:h-10"
          disabled={create.isPending}
          onClick={onClose}
        >
          Annuler
        </Button>
        <SubmitButton pending={create.isPending}>Créer la sauvegarde</SubmitButton>
      </DialogFooter>
    </form>
  );
}

function BackupRow({
  backup,
  onAction,
}: {
  backup: DatabaseBackup;
  onAction: (action: BackupAction) => void;
}) {
  const inProgress = backup.status === "in_progress";

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE.out } }}
      className="flex items-center gap-3 px-4 py-3"
    >
      <span
        aria-hidden="true"
        className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground sm:flex"
      >
        <Archive className="size-4" />
      </span>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p title={backup.label} className="max-w-full truncate text-sm font-medium">
            {backup.label}
          </p>
          <Badge variant="outline">{backup.type === "automatic" ? "Automatique" : "Manuelle"}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <StatusBadge kind="backup" status={backup.status} size="sm" />
          <span className="tabular">{inProgress ? "—" : formatMegabytes(backup.sizeMb)}</span>
          <span title={formatDateTime(backup.createdAt)}>
            <RelativeTime date={backup.createdAt} />
          </span>
        </div>
        {inProgress ? <ProgressBar indeterminate size="sm" label="Sauvegarde en cours" /> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="max-sm:h-9"
          disabled={backup.status !== "completed"}
          aria-label={`Restaurer ${backup.label}`}
          onClick={() => onAction({ kind: "restore", backup })}
        >
          <RotateCcw data-icon="inline-start" />
          <span className="max-sm:sr-only">Restaurer</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive max-sm:size-9"
          disabled={inProgress}
          aria-label={`Supprimer ${backup.label}`}
          onClick={() => onAction({ kind: "delete", backup })}
        >
          <Trash2 />
        </Button>
      </div>
    </motion.li>
  );
}

function BackupsContent({ database }: { database: Database }) {
  const backups = useDatabaseBackups(database.id);
  const restore = useRestoreBackup();
  const remove = useDeleteBackup();
  const [createOpen, setCreateOpen] = useState(false);
  // The action outlives its dialog so the text does not change while it closes.
  const [action, setAction] = useState<BackupAction | null>(null);
  const [actionOpen, setActionOpen] = useState(false);

  function ask(next: BackupAction) {
    setAction(next);
    setActionOpen(true);
  }

  async function confirm() {
    if (!action) return;
    const { kind, backup } = action;
    try {
      if (kind === "restore") {
        await restore.mutateAsync({ databaseId: database.id, backupId: backup.id });
        toast.success("Restauration lancée", {
          description: `${database.name} redémarre avec « ${backup.label} ».`,
        });
      } else {
        await remove.mutateAsync({ databaseId: database.id, backupId: backup.id });
        toast.success("Sauvegarde supprimée", { description: backup.label });
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setActionOpen(false);
    }
  }

  const list = backups.data;
  const createButton = (
    <Button className="max-sm:h-10" onClick={() => setCreateOpen(true)}>
      <Plus data-icon="inline-start" />
      Créer une sauvegarde
    </Button>
  );

  let content;
  if (backups.isError && !list) {
    content = (
      <ErrorState
        compact
        title="Impossible de charger les sauvegardes"
        error={backups.error}
        onRetry={() => void backups.refetch()}
      />
    );
  } else if (!list) {
    content = <BackupsSkeleton />;
  } else if (list.length === 0) {
    content = (
      <EmptyState
        icon={Archive}
        title="Aucune sauvegarde"
        description="Créez une sauvegarde manuelle avant une migration ou une opération risquée."
        action={createButton}
      />
    );
  } else {
    content = (
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        <AnimatePresence initial={false}>
          {list.map((backup) => (
            <BackupRow key={backup.id} backup={backup} onAction={ask} />
          ))}
        </AnimatePresence>
      </ul>
    );
  }

  return (
    <div className="@container space-y-4">
      {list && list.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">Sauvegardes</h2>
            <p className="text-xs text-muted-foreground">
              {pluralize(list.length, "sauvegarde")} · les sauvegardes automatiques sont créées
              chaque jour.
            </p>
          </div>
          {createButton}
        </div>
      ) : null}

      {content}

      <CreateBackupDialog database={database} open={createOpen} onOpenChange={setCreateOpen} />

      {action ? (
        <ConfirmDialog
          open={actionOpen}
          onOpenChange={setActionOpen}
          tone="danger"
          title={action.kind === "restore" ? "Restaurer cette sauvegarde" : "Supprimer la sauvegarde"}
          description={
            action.kind === "restore"
              ? `Les données actuelles de ${database.name} seront écrasées par celles de « ${action.backup.label} » (${formatDateTime(action.backup.createdAt)}). La base redémarrera pendant la restauration. Cette action est irréversible.`
              : `La sauvegarde « ${action.backup.label} » sera supprimée définitivement.`
          }
          confirmLabel={action.kind === "restore" ? "Restaurer" : "Supprimer"}
          onConfirm={confirm}
        />
      ) : null}
    </div>
  );
}
