"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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
import { getErrorMessage } from "@/lib/api/contract";
import { useCreateProject, useProjects, useSettings } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { PROJECT_COLORS, REGIONS, type Project } from "@/lib/types";

import {
  apiFieldErrors,
  clearErrorsFor,
  hasErrors,
  validateDescription,
  validateName,
  validateProjectForm,
  type ProjectFormErrors,
  type ProjectFormValues,
} from "../lib/project-form";
import { ProjectFormFields } from "./project-form-fields";
import { SubmitButton } from "./submit-button";

export interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new project once it exists. */
  onCreated?: (project: Project) => void;
}

/**
 * Creation form of a project. Without `onCreated`, the user lands on the
 * workspace of the new project.
 */
export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  // Owned here, not by the form: the form unmounts with the dialog content, and
  // a closed dialog would silently drop the result of a request still running.
  const create = useCreateProject();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <CreateProjectForm
          create={create}
          onClose={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  );
}

interface CreateProjectFormProps {
  create: ReturnType<typeof useCreateProject>;
  onClose: () => void;
  onCreated?: (project: Project) => void;
}

// Rendered inside the dialog content, which unmounts on close: every opening
// starts from a blank form.
function CreateProjectForm({ create, onClose, onCreated }: CreateProjectFormProps) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const projects = useProjects();
  const settings = useSettings();
  const [draft, setDraft] = useState<Partial<ProjectFormValues>>({});
  const [errors, setErrors] = useState<ProjectFormErrors>({});

  // Until the user picks one, the colour rotates through the palette (like the
  // API does) and the region follows the platform default.
  const values: ProjectFormValues = {
    name: draft.name ?? "",
    description: draft.description ?? "",
    color: draft.color ?? PROJECT_COLORS[(projects.data?.length ?? 0) % PROJECT_COLORS.length],
    region: draft.region ?? settings.data?.defaultRegion ?? REGIONS[0],
  };

  function handleChange(patch: Partial<ProjectFormValues>) {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors((current) => clearErrorsFor(current, patch));
  }

  function handleBlur(field: "name" | "description") {
    // An empty name is only reported on submit: the user may be heading for "Annuler".
    if (field === "name" && values.name === "") return;
    const message =
      field === "name" ? validateName(values.name) : validateDescription(values.description);
    if (!message) return;
    setErrors((current) =>
      field === "name" ? { ...current, name: message } : { ...current, description: message },
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;

    const found = validateProjectForm(values);
    if (hasErrors(found)) {
      setErrors(found);
      if (found.name) nameRef.current?.focus();
      return;
    }

    const description = values.description.trim();
    create.mutate(
      {
        name: values.name.trim(),
        description: description || undefined,
        color: values.color,
        region: values.region,
      },
      {
        onSuccess: (project) => {
          toast.success("Projet créé", { description: project.name });
          onClose();
          if (onCreated) onCreated(project);
          else router.push(routes.workspace(project.id));
        },
        onError: (error) => {
          const fieldErrors = apiFieldErrors(error);
          if (!fieldErrors) {
            toast.error(getErrorMessage(error));
            return;
          }
          setErrors(fieldErrors);
          if (fieldErrors.name) nameRef.current?.focus();
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Nouveau projet</DialogTitle>
        <DialogDescription>
          Un projet regroupe vos services, bases de données et domaines dans un même workspace.
        </DialogDescription>
      </DialogHeader>

      <ProjectFormFields
        values={values}
        errors={errors}
        onChange={handleChange}
        onBlurField={handleBlur}
        nameRef={nameRef}
      />

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="max-sm:h-10"
          disabled={create.isPending}
          onClick={onClose}
        >
          Annuler
        </Button>
        <SubmitButton pending={create.isPending}>Créer le projet</SubmitButton>
      </DialogFooter>
    </form>
  );
}
