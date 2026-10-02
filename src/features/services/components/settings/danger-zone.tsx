"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Service } from "@/lib/types";

import { DeleteServiceDialog } from "../delete-service-dialog";

/** Deleting the service, behind the same typed confirmation as the "…" menu. */
export function ServiceDangerZone({ service, onDeleted }: { service: Service; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 @md:flex-row @md:items-center @md:justify-between @md:p-5">
      <div className="min-w-0">
        <h4 className="text-sm font-medium">Supprimer ce service</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Déploiements, variables, domaines et volume sont supprimés définitivement.
        </p>
      </div>
      <Button type="button" variant="destructive" className="shrink-0" onClick={() => setOpen(true)}>
        <Trash2 data-icon="inline-start" />
        Supprimer le service
      </Button>
      <DeleteServiceDialog service={service} open={open} onOpenChange={setOpen} onDeleted={onDeleted} />
    </div>
  );
}
