"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { getErrorMessage } from "@/lib/api/contract";
import { useResetDemoData } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { useUiStore } from "@/stores/ui-store";

interface ResetDemoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Confirmation behind every "Réinitialiser la démo" entry point of the shell. */
export function ResetDemoDialog({ open, onOpenChange }: ResetDemoDialogProps) {
  const router = useRouter();
  const reset = useResetDemoData();

  const handleConfirm = () =>
    reset.mutateAsync().then(
      () => {
        // The remembered project may not exist in the restored data set.
        useUiStore.getState().setLastProjectId(null);
        onOpenChange(false);
        toast.success("Données de démo réinitialisées");
        // The page on screen may show something that no longer exists.
        router.push(routes.dashboard());
      },
      (error: unknown) => {
        toast.error(getErrorMessage(error, "Impossible de réinitialiser la démo."));
      },
    );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title="Réinitialiser la démo"
      description="Les projets, services, déploiements, variables et domaines reviendront à leur état initial. Les modifications faites dans ce navigateur seront perdues."
      confirmLabel="Réinitialiser"
      loading={reset.isPending}
      onConfirm={handleConfirm}
    />
  );
}
