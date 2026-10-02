"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ServiceType } from "@/lib/types";

import { AddOptionList } from "./add-options";

export interface AddServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (kind: ServiceType) => void;
}

/** "Ajouter": picks the kind of service, the matching creation flow takes over. */
export function AddServiceDialog({ open, onOpenChange, onChoose }: AddServiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Que souhaitez-vous ajouter ?</DialogTitle>
          <DialogDescription>
            Choisissez la source de votre nouveau service, il apparaîtra sur le canvas.
          </DialogDescription>
        </DialogHeader>
        <AddOptionList onChoose={onChoose} />
      </DialogContent>
    </Dialog>
  );
}
