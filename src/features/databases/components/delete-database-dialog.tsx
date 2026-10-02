"use client";

import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { getErrorMessage } from "@/lib/api/contract";
import { useDeleteService } from "@/lib/queries";
import type { Database } from "@/lib/types";

export interface DeleteDatabaseDialogProps {
  database: Pick<Database, "name" | "serviceId">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs once the database is gone (navigation away from a page that showed it). */
  onDeleted?: () => void;
}

/** Typed confirmation, then the backing service (and with it the database) is deleted. */
export function DeleteDatabaseDialog({
  database,
  open,
  onOpenChange,
  onDeleted,
}: DeleteDatabaseDialogProps) {
  const remove = useDeleteService();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title="Supprimer la base de données"
      description={`La base « ${database.name} », son volume, ses sauvegardes et ses connexions seront supprimés définitivement. Cette action est irréversible.`}
      confirmText={database.name}
      loading={remove.isPending}
      onConfirm={() =>
        remove.mutate(database.serviceId, {
          onSuccess: () => {
            toast.success("Base supprimée", { description: database.name });
            onOpenChange(false);
            onDeleted?.();
          },
          onError: (error) => toast.error(getErrorMessage(error)),
        })
      }
    />
  );
}
