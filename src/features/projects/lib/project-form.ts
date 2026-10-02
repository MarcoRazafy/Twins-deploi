import { isApiError } from "@/lib/api/contract";
import { PROJECT_COLORS, REGIONS, type ProjectColor, type Region } from "@/lib/types";

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 40;
export const DESCRIPTION_MAX_LENGTH = 280;

export const PROJECT_FORM_FIELDS = ["name", "description", "color", "region"] as const;
export type ProjectFormField = (typeof PROJECT_FORM_FIELDS)[number];

export interface ProjectFormValues {
  name: string;
  description: string;
  color: ProjectColor;
  region: Region;
}

export type ProjectFormErrors = Partial<Record<ProjectFormField, string>>;

/** Spoken names of the swatches (the colour alone is never the only signal). */
export const COLOR_LABELS: Record<ProjectColor, string> = {
  purple: "Violet",
  blue: "Bleu",
  green: "Vert",
  amber: "Ambre",
  pink: "Rose",
  cyan: "Cyan",
};

// The wording mirrors the API so a client-side and a server-side rejection read alike.
export function validateName(name: string): string | null {
  const length = name.trim().length;
  if (length === 0) return "Le nom du projet est obligatoire.";
  if (length < NAME_MIN_LENGTH || length > NAME_MAX_LENGTH) {
    return `Le nom du projet doit contenir entre ${NAME_MIN_LENGTH} et ${NAME_MAX_LENGTH} caractères.`;
  }
  return null;
}

export function validateDescription(description: string): string | null {
  if (description.trim().length > DESCRIPTION_MAX_LENGTH) {
    return `La description ne peut pas dépasser ${DESCRIPTION_MAX_LENGTH} caractères.`;
  }
  return null;
}

export function validateProjectForm(
  values: Pick<ProjectFormValues, "name" | "description">,
): ProjectFormErrors {
  const errors: ProjectFormErrors = {};
  const name = validateName(values.name);
  if (name) errors.name = name;
  const description = validateDescription(values.description);
  if (description) errors.description = description;
  return errors;
}

export function hasErrors(errors: ProjectFormErrors): boolean {
  return PROJECT_FORM_FIELDS.some((field) => errors[field] !== undefined);
}

/** Drops the errors of the fields being edited: they are re-checked on blur or submit. */
export function clearErrorsFor(
  errors: ProjectFormErrors,
  patch: Partial<ProjectFormValues>,
): ProjectFormErrors {
  const next: ProjectFormErrors = { ...errors };
  for (const field of PROJECT_FORM_FIELDS) {
    if (field in patch) delete next[field];
  }
  return next;
}

/** The inline error an API failure points at, or null when it points at no form field. */
export function apiFieldErrors(error: unknown): ProjectFormErrors | null {
  if (!isApiError(error) || !error.field) return null;
  const apiField = error.field;
  const field = PROJECT_FORM_FIELDS.find((candidate) => candidate === apiField);
  if (!field) return null;
  const errors: ProjectFormErrors = {};
  errors[field] = error.message;
  return errors;
}

export function parseProjectColor(value: string): ProjectColor | null {
  return PROJECT_COLORS.find((color) => color === value) ?? null;
}

export function parseRegion(value: string): Region | null {
  return REGIONS.find((region) => region === value) ?? null;
}
