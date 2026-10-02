"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { API_MODE } from "@/lib/api";
import { useResetDemoData } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { useUiStore } from "@/stores/ui-store";

import { notifyError } from "../lib/errors";

function ResetDemoCard() {
  const router = useRouter();
  const reset = useResetDemoData();
  const [open, setOpen] = useState(false);

  async function confirmReset() {
    try {
      await reset.mutateAsync();
      // The remembered project may no longer exist in the restored data.
      useUiStore.getState().setLastProjectId(null);
      toast.success("Données de démo réinitialisées");
      setOpen(false);
      router.push(routes.dashboard());
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <>
      <SectionCard
        tone="danger"
        title="Réinitialiser les données de démo"
        description="Les données simulées stockées dans ce navigateur (projets, services, déploiements, réglages) seront restaurées à leur état initial. Vos modifications seront perdues."
        actions={
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <RotateCcw data-icon="inline-start" />
            Réinitialiser
          </Button>
        }
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title="Réinitialiser les données de démo"
        description="Toutes les données simulées de ce navigateur reviendront à leur état initial. Cette action est irréversible."
        confirmLabel="Réinitialiser"
        confirmText="RÉINITIALISER"
        loading={reset.isPending}
        onConfirm={confirmReset}
      />
    </>
  );
}

export function DangerSection() {
  if (API_MODE === "mock") return <ResetDemoCard />;

  return (
    <SectionCard
      title="Zone de danger"
      description="Aucune action destructive n’est proposée ici : les données sont gérées par le serveur."
    >
      <div className="flex items-start gap-2 rounded-lg bg-secondary px-3 py-2.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          Pour supprimer un projet, un service ou une base de données, utilisez leurs réglages respectifs : chaque
          suppression y demande une confirmation.
        </p>
      </div>
    </SectionCard>
  );
}
