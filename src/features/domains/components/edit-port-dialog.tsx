"use client";

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

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
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { useUpdateDomain } from "@/lib/queries";
import type { Domain } from "@/lib/types";

import { parsePort, PORT_ERROR } from "../lib/domain-utils";

function EditPortForm({ domain, onDone }: { domain: Domain; onDone: () => void }) {
  const id = useId();
  const update = useUpdateDomain();
  const [draft, setDraft] = useState(String(domain.targetPort));
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const port = parsePort(draft);
    if (port === null) {
      setError(PORT_ERROR);
      return;
    }
    try {
      await update.mutateAsync({ id: domain.id, patch: { targetPort: port } });
      toast.success("Port enregistré", { description: `${domain.hostname} → port ${port}` });
      onDone();
    } catch (caught) {
      if (isApiError(caught) && caught.field === "targetPort") setError(caught.message);
      else toast.error(getErrorMessage(caught));
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Modifier le port</DialogTitle>
        <DialogDescription>
          Port du conteneur vers lequel NGINX redirige le trafic de{" "}
          <span className="font-mono text-foreground">{domain.hostname}</span>.
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>Port cible</FieldLabel>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={65535}
          autoFocus
          value={draft}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onBlur={() => setError(parsePort(draft) === null ? PORT_ERROR : null)}
          className="font-mono tabular"
        />
        <FieldDescription>Un entier entre 1 et 65535.</FieldDescription>
        <FieldError>{error}</FieldError>
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? <Spinner data-icon="inline-start" /> : null}
          Enregistrer
        </Button>
      </DialogFooter>
    </form>
  );
}

export interface EditPortDialogProps {
  /** Kept after closing so the text does not blank out during the exit animation. */
  domain: Domain | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Changes the target port of one domain (service panel). */
export function EditPortDialog({ domain, open, onOpenChange }: EditPortDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {domain ? (
          <EditPortForm key={domain.id} domain={domain} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
