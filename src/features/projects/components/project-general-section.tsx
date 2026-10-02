"use client";

import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { SectionCard } from "@/components/shared/section-card";
import { StatusDot } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { getErrorMessage, type UpdateProjectInput } from "@/lib/api/contract";
import { useUpdateProject } from "@/lib/queries";
import type { ProjectSummary } from "@/lib/types";

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

/** Only what differs from the saved project: nothing to send means nothing to save. */
function buildPatch(project: ProjectSummary, values: ProjectFormValues): UpdateProjectInput {
  const patch: UpdateProjectInput = {};
  const name = values.name.trim();
  const description = values.description.trim();
  if (name !== project.name) patch.name = name;
  if (description !== project.description) patch.description = description;
  if (values.color !== project.color) patch.color = values.color;
  if (values.region !== project.region) patch.region = values.region;
  return patch;
}

/** "Général" card: the editable fields of a project, with dirty-state tracking. */
export function ProjectGeneralSection({ project }: { project: ProjectSummary }) {
  const update = useUpdateProject();
  const nameRef = useRef<HTMLInputElement>(null);
  // Only the fields the user touched: everything else follows the saved project,
  // so a refetch (or a rename from the list) never leaves a stale copy behind.
  const [draft, setDraft] = useState<Partial<ProjectFormValues>>({});
  const [errors, setErrors] = useState<ProjectFormErrors>({});

  const values: ProjectFormValues = {
    name: draft.name ?? project.name,
    description: draft.description ?? project.description,
    color: draft.color ?? project.color,
    region: draft.region ?? project.region,
  };
  const dirty =
    values.name !== project.name ||
    values.description !== project.description ||
    values.color !== project.color ||
    values.region !== project.region;

  function handleChange(patch: Partial<ProjectFormValues>) {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors((current) => clearErrorsFor(current, patch));
  }

  function handleBlur(field: "name" | "description") {
    const message =
      field === "name" ? validateName(values.name) : validateDescription(values.description);
    if (!message) return;
    setErrors((current) =>
      field === "name" ? { ...current, name: message } : { ...current, description: message },
    );
  }

  function handleCancel() {
    setDraft({});
    setErrors({});
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (update.isPending || !dirty) return;

    const found = validateProjectForm(values);
    if (hasErrors(found)) {
      setErrors(found);
      if (found.name) nameRef.current?.focus();
      return;
    }

    const patch = buildPatch(project, values);
    if (Object.keys(patch).length === 0) {
      // Whitespace-only edits: nothing to save, the draft is just dropped.
      handleCancel();
      return;
    }

    update.mutate(
      { id: project.id, patch },
      {
        onSuccess: () => {
          toast.success("Réglages enregistrés");
          handleCancel();
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
    <form onSubmit={handleSubmit} noValidate>
      <SectionCard
        title="Général"
        description="Nom, description, couleur et région du projet."
        footer={
          <>
            <span role="status" className="inline-flex items-center gap-2">
              {dirty ? (
                <>
                  <StatusDot tone="warning" />
                  Modifications non enregistrées
                </>
              ) : (
                "Aucune modification"
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="max-sm:h-10"
                disabled={!dirty || update.isPending}
                onClick={handleCancel}
              >
                Annuler
              </Button>
              <SubmitButton pending={update.isPending} disabled={!dirty}>
                Enregistrer
              </SubmitButton>
            </div>
          </>
        }
      >
        <ProjectFormFields
          values={values}
          errors={errors}
          onChange={handleChange}
          onBlurField={handleBlur}
          nameRef={nameRef}
        />
      </SectionCard>
    </form>
  );
}
