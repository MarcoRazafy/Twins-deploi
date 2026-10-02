"use client";

import { useState, type FormEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { CodeBlock } from "@/components/shared/code-block";
import { CopyField } from "@/components/shared/copy-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { isApiError } from "@/lib/api/contract";
import { useCreateApiToken } from "@/lib/queries";

import { notifyError } from "../lib/errors";
import { validateText } from "../lib/validation";
import { FormField, describedBy } from "./form-parts";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 jours", days: 30 },
  { value: "90", label: "90 jours", days: 90 },
  { value: "365", label: "1 an", days: 365 },
  { value: "never", label: "Jamais", days: null },
] as const;

function usageSnippet(secret: string): string {
  return [
    "# Lister vos projets avec ce jeton",
    "curl https://api.mini-railway.app/v1/projects \\",
    `  -H "Authorization: Bearer ${secret}"`,
  ].join("\n");
}

function TokenForm({ onCreated, onCancel }: { onCreated: (secret: string) => void; onCancel: () => void }) {
  const create = useCreateApiToken();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<string>("90");
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateText(name, { min: 2, max: 40, label: "Le nom" });
    setError(problem);
    if (problem) return;
    const days = EXPIRY_OPTIONS.find((option) => option.value === expiry)?.days ?? null;
    try {
      const { secret } = await create.mutateAsync({ name: name.trim(), expiresInDays: days });
      onCreated(secret);
    } catch (failure) {
      if (isApiError(failure) && failure.field === "name") setError(failure.message);
      else notifyError(failure);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Créer un jeton d’API</DialogTitle>
        <DialogDescription>Un jeton donne accès à l’API avec vos droits. Donnez-lui un nom reconnaissable.</DialogDescription>
      </DialogHeader>
      <FormField id="token-name" label="Nom" error={error}>
        <Input
          id="token-name"
          autoFocus
          autoComplete="off"
          placeholder="ci-github-actions"
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy("token-name", false, error)}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(validateText(event.target.value, { min: 2, max: 40, label: "Le nom" }));
          }}
          onBlur={() => setError(name ? validateText(name, { min: 2, max: 40, label: "Le nom" }) : undefined)}
        />
      </FormField>
      <FormField id="token-expiry" label="Expiration">
        <Select value={expiry} onValueChange={setExpiry}>
          <SelectTrigger id="token-expiry" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={create.isPending}>
          Annuler
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner data-icon="inline-start" /> : null}
          Créer le jeton
        </Button>
      </DialogFooter>
    </form>
  );
}

function SecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Jeton créé</DialogTitle>
        <DialogDescription>Copiez-le maintenant et conservez-le dans un endroit sûr.</DialogDescription>
      </DialogHeader>
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2.5 text-sm text-warning"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <p>Ce jeton ne sera plus affiché après la fermeture de cette fenêtre.</p>
      </div>
      <CopyField label="Votre jeton" value={secret} mono />
      <CodeBlock code={usageSnippet(secret)} language="bash" title="Exemple d’utilisation" wrap />
      <DialogFooter>
        <Button
          onClick={() => {
            toast.success("Jeton prêt à l’emploi");
            onDone();
          }}
        >
          J’ai copié le jeton
        </Button>
      </DialogFooter>
    </div>
  );
}

interface CreateTokenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTokenDialog({ open, onOpenChange }: CreateTokenDialogProps) {
  const [secret, setSecret] = useState<string | null>(null);

  // Revealing the secret locks the dialog: only the explicit button closes it.
  const locked = secret !== null;

  function handleOpenChange(next: boolean) {
    if (!next && locked) return;
    onOpenChange(next);
  }

  // The parent remounts the dialog (key) on every opening, so nothing needs clearing here.
  function finish() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={!locked}
        onEscapeKeyDown={(event) => {
          if (locked) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (locked) event.preventDefault();
        }}
      >
        {secret === null ? (
          <TokenForm onCreated={setSecret} onCancel={() => onOpenChange(false)} />
        ) : (
          <SecretReveal secret={secret} onDone={finish} />
        )}
      </DialogContent>
    </Dialog>
  );
}
