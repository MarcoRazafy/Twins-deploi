"use client";

import { useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { isApiError } from "@/lib/api/contract";
import { MEMBER_ROLE_LABELS } from "@/lib/constants";
import { useInviteMember } from "@/lib/queries";
import type { MemberRole } from "@/lib/types";

import { notifyError } from "../lib/errors";
import { validateEmail } from "../lib/validation";
import { FormField, describedBy } from "./form-parts";

type AssignableRole = Exclude<MemberRole, "owner">;

const ROLES: ReadonlyArray<{ value: AssignableRole; description: string }> = [
  { value: "admin", description: "Gère les projets, les membres et les réglages." },
  { value: "developer", description: "Déploie et configure les services et les bases." },
  { value: "viewer", description: "Consulte les projets sans rien modifier." },
];

function InviteForm({ onDone }: { onDone: () => void }) {
  const invite = useInviteMember();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("developer");
  const [error, setError] = useState<string | undefined>();
  const selected = ROLES.find((item) => item.value === role);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateEmail(email);
    setError(problem);
    if (problem) return;
    try {
      await invite.mutateAsync({ email: email.trim(), role });
      toast.success("Invitation envoyée", { description: email.trim() });
      onDone();
    } catch (failure) {
      if (isApiError(failure) && failure.field === "email") setError(failure.message);
      else notifyError(failure);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Inviter un membre</DialogTitle>
        <DialogDescription>
          La personne apparaît comme « Invité » jusqu’à sa première connexion.
        </DialogDescription>
      </DialogHeader>
      <FormField id="invite-email" label="Adresse e-mail" error={error}>
        <Input
          id="invite-email"
          type="email"
          autoFocus
          autoComplete="off"
          placeholder="prenom.nom@exemple.mg"
          value={email}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy("invite-email", false, error)}
          onChange={(event) => {
            setEmail(event.target.value);
            if (error) setError(validateEmail(event.target.value));
          }}
          onBlur={() => setError(email ? validateEmail(email) : undefined)}
        />
      </FormField>
      <FormField id="invite-role" label="Rôle" description={selected?.description}>
        <Select value={role} onValueChange={(value) => setRole(value as AssignableRole)}>
          <SelectTrigger id="invite-role" className="w-full">
            <SelectValue>{MEMBER_ROLE_LABELS[role]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <span className="flex flex-col items-start gap-0.5 py-0.5">
                  <span>{MEMBER_ROLE_LABELS[item.value]}</span>
                  <span className="text-xs text-muted-foreground">{item.description}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={invite.isPending}>
          Annuler
        </Button>
        <Button type="submit" disabled={invite.isPending}>
          {invite.isPending ? <Spinner data-icon="inline-start" /> : null}
          Inviter
        </Button>
      </DialogFooter>
    </form>
  );
}

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteMemberDialog({ open, onOpenChange }: InviteMemberDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <InviteForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
