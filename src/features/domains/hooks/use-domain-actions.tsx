"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { getErrorMessage } from "@/lib/api/contract";
import { useDeleteDomain, useVerifyDomain } from "@/lib/queries";
import type { Domain } from "@/lib/types";

type VerifiableDomain = Pick<Domain, "id" | "hostname">;

/** Starts a DNS check and reports how it went; the later steps arrive through the realtime bridge. */
export function useVerifyDomainAction() {
  const { mutate, isPending } = useVerifyDomain();

  function verify(domain: VerifiableDomain) {
    mutate(domain.id, {
      onSuccess: (updated) => {
        if (updated.status === "active") {
          toast.success("Configuration vérifiée", { description: domain.hostname });
        } else {
          toast.info("Vérification lancée", {
            description: `${domain.hostname} · suivez l’avancement en direct.`,
          });
        }
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  }

  return { verify, isPending };
}

export interface DomainActions {
  verify: (domain: VerifiableDomain) => void;
  /** Opens the confirmation dialog; the deletion happens once it is confirmed. */
  requestDelete: (domain: Domain) => void;
  /** The confirmation dialog: render it once, next to the list that uses the actions. */
  dialogs: ReactNode;
}

interface DomainActionsOptions {
  /** Called once the domain is gone (close a detail panel, for instance). */
  onDeleted?: (domain: Domain) => void;
}

/** Verify and delete (with confirmation) shared by the table, the detail sheet and the service panel. */
export function useDomainActions({ onDeleted }: DomainActionsOptions = {}): DomainActions {
  const { verify } = useVerifyDomainAction();
  const { mutateAsync: deleteDomain } = useDeleteDomain();
  // The target outlives the dialog so its text does not blank out while it closes.
  const [target, setTarget] = useState<Domain | null>(null);
  const [open, setOpen] = useState(false);

  async function confirmDelete() {
    if (!target) return;
    try {
      await deleteDomain(target.id);
      toast.success("Domaine supprimé", { description: target.hostname });
      setOpen(false);
      onDeleted?.(target);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return {
    verify,
    requestDelete: (domain) => {
      setTarget(domain);
      setOpen(true);
    },
    dialogs: (
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title="Supprimer ce domaine ?"
        confirmLabel="Supprimer"
        description={
          target ? (
            <>
              <span className="font-mono text-foreground">{target.hostname}</span> ne sera plus servi
              par la plateforme.{" "}
              {target.kind === "custom"
                ? "Les enregistrements DNS créés chez votre registrar restent en place : pensez à les retirer."
                : "Cette adresse générée sera définitivement libérée."}
            </>
          ) : null
        }
        onConfirm={confirmDelete}
      />
    ),
  };
}
