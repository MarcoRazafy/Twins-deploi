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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { useUpdateProject } from "@/lib/queries";
import type { Project } from "@/lib/types";

import { validateName } from "../lib/project-form";
import { SubmitButton } from "./submit-button";

export interface RenameProjectDialogProps {
  project: Pick<Project, "id" | "name">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Small dialog of the "Renommer" menu entry. */
export function RenameProjectDialog({ project, open, onOpenChange }: RenameProjectDialogProps) {
  // Owned here so that a request in flight survives the unmount of the form.
  const rename = useUpdateProject();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && rename.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <RenameProjectForm
          project={project}
          rename={rename}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface RenameProjectFormProps {
  project: Pick<Project, "id" | "name">;
  rename: ReturnType<typeof useUpdateProject>;
  onClose: () => void;
}

function RenameProjectForm({ project, rename, onClose }: RenameProjectFormProps) {
  const fieldId = useId();
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rename.isPending) return;

    const message = validateName(name);
    if (message) {
      setError(message);
      return;
    }

    const next = name.trim();
    if (next === project.name) {
      onClose();
      return;
    }

    rename.mutate(
      { id: project.id, patch: { name: next } },
      {
        onSuccess: () => {
          toast.success("Projet renommé", { description: next });
          onClose();
        },
        onError: (failure) => {
          if (isApiError(failure) && failure.field === "name") setError(failure.message);
          else toast.error(getErrorMessage(failure));
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Renommer le projet</DialogTitle>
        <DialogDescription>Le nom doit être unique dans l’espace de travail.</DialogDescription>
      </DialogHeader>

      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={fieldId}>Nom</FieldLabel>
        <Input
          id={fieldId}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onFocus={(event) => event.currentTarget.select()}
          autoComplete="off"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
        />
        {error ? <FieldError id={`${fieldId}-error`}>{error}</FieldError> : null}
      </Field>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="max-sm:h-10"
          disabled={rename.isPending}
          onClick={onClose}
        >
          Annuler
        </Button>
        <SubmitButton pending={rename.isPending}>Enregistrer</SubmitButton>
      </DialogFooter>
    </form>
  );
}
