"use client";

import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { getErrorMessage } from "@/lib/api/contract";
import { useDeleteService } from "@/lib/queries";
import type { Service } from "@/lib/types";

interface DeleteServiceDialogProps {
  service: Pick<Service, "id" | "name">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the service is gone (the panel closes). */
  onDeleted: () => void;
}

/** Typed confirmation shared by the "…" menu and the danger zone. */
export function DeleteServiceDialog({ service, open, onOpenChange, onDeleted }: DeleteServiceDialogProps) {
  const remove = useDeleteService();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title="Supprimer le service"
      description="Le service, ses déploiements, ses variables, ses domaines et son volume seront supprimés définitivement. Cette action est irréversible."
      confirmText={service.name}
      loading={remove.isPending}
      onConfirm={async () => {
        try {
          await remove.mutateAsync(service.id);
        } catch (error) {
          toast.error(getErrorMessage(error));
          return;
        }
        toast.success("Service supprimé", { description: service.name });
        onOpenChange(false);
        onDeleted();
      }}
    />
  );
}
