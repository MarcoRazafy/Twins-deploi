"use client";

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { useUpdateDomain } from "@/lib/queries";
import type { Domain } from "@/lib/types";

import { parsePort, PORT_ERROR } from "../lib/domain-utils";

function PortField({ domain }: { domain: Domain }) {
  const id = useId();
  const update = useUpdateDomain();
  const [draft, setDraft] = useState(String(domain.targetPort));
  const [error, setError] = useState<string | null>(null);

  const parsed = parsePort(draft);
  const dirty = draft.trim() !== String(domain.targetPort);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (parsed === null) {
      setError(PORT_ERROR);
      return;
    }
    try {
      await update.mutateAsync({ id: domain.id, patch: { targetPort: parsed } });
      toast.success("Port enregistré", { description: `${domain.hostname} → port ${parsed}` });
    } catch (caught) {
      if (isApiError(caught) && caught.field === "targetPort") setError(caught.message);
      else toast.error(getErrorMessage(caught));
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>Port cible</FieldLabel>
        <div className="flex gap-2">
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            value={draft}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(null);
            }}
            onBlur={() => setError(parsed === null ? PORT_ERROR : null)}
            className="w-32 font-mono tabular"
          />
          <Button type="submit" variant="secondary" disabled={!dirty || update.isPending}>
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            Enregistrer
          </Button>
        </div>
        <FieldDescription>
          Port du conteneur vers lequel NGINX redirige le trafic de ce domaine.
        </FieldDescription>
        <FieldError>{error}</FieldError>
      </Field>
    </form>
  );
}

function HttpsField({ domain }: { domain: Domain }) {
  const id = useId();
  const { mutate, isPending } = useUpdateDomain();
  // Shows the new position at once; the stored value takes over when the save settles.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const checked = optimistic ?? domain.forceHttps;

  function toggle(next: boolean) {
    setOptimistic(next);
    mutate(
      { id: domain.id, patch: { forceHttps: next } },
      {
        onSuccess: () =>
          toast.success(next ? "Redirection HTTPS activée" : "Redirection HTTPS désactivée", {
            description: domain.hostname,
          }),
        onError: (error) => toast.error(getErrorMessage(error)),
        onSettled: () => setOptimistic(null),
      },
    );
  }

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>Forcer HTTPS</FieldLabel>
        <FieldDescription>
          Redirige tout le trafic HTTP vers HTTPS (code 301) et envoie l’en-tête HSTS.
        </FieldDescription>
      </FieldContent>
      <Switch id={id} checked={checked} disabled={isPending} onCheckedChange={toggle} />
    </Field>
  );
}

/** Target port (saved on demand) and the HTTPS redirection (saved on toggle). */
export function DomainConfigSection({ domain }: { domain: Domain }) {
  return (
    <FieldGroup className="gap-5">
      {/* Remounts when the saved port changes so the draft follows it. */}
      <PortField key={`${domain.id}:${domain.targetPort}`} domain={domain} />
      <div className="border-t pt-5">
        <HttpsField domain={domain} />
      </div>
    </FieldGroup>
  );
}
