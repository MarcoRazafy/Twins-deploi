"use client";

import { useId, type Ref } from "react";
import { Check } from "lucide-react";

import { ProjectAvatar } from "@/components/shared/project-avatar";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_COLOR_CLASSES, REGION_LABELS } from "@/lib/constants";
import { PROJECT_COLORS, REGIONS, type ProjectColor } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  COLOR_LABELS,
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  parseRegion,
  type ProjectFormErrors,
  type ProjectFormValues,
} from "../lib/project-form";

interface ProjectColorPickerProps {
  value: ProjectColor;
  onChange: (color: ProjectColor) => void;
}

/**
 * Native radio inputs drawn as swatches: group semantics, arrow-key
 * navigation and the form behaviour come for free, and the checked state is
 * read from CSS instead of being duplicated in script.
 */
function ProjectColorPicker({ value, onChange }: ProjectColorPickerProps) {
  const groupName = useId();

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {PROJECT_COLORS.map((color) => (
        <label key={color} className="group/swatch relative cursor-pointer">
          <input
            type="radio"
            name={groupName}
            value={color}
            checked={value === color}
            onChange={() => onChange(color)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cn(
              "flex size-7 items-center justify-center rounded-full outline-2 outline-offset-2 outline-transparent transition-[outline-color,box-shadow]",
              PROJECT_COLOR_CLASSES[color].dot,
              "group-has-[:checked]/swatch:outline-foreground",
              "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
            )}
          >
            <Check
              strokeWidth={3}
              className="size-3.5 text-background opacity-0 transition-opacity group-has-[:checked]/swatch:opacity-100"
            />
          </span>
          <span className="sr-only">{COLOR_LABELS[color]}</span>
        </label>
      ))}
    </div>
  );
}

export interface ProjectFormFieldsProps {
  values: ProjectFormValues;
  errors: ProjectFormErrors;
  /** Receives only the fields that changed. */
  onChange: (patch: Partial<ProjectFormValues>) => void;
  /** Validation on blur, per the form recipe of the design system. */
  onBlurField?: (field: "name" | "description") => void;
  /** Lets the parent move the focus to the name on a rejected submit. */
  nameRef?: Ref<HTMLInputElement>;
}

/** The four project fields, shared by the creation dialog and the settings page. */
export function ProjectFormFields({
  values,
  errors,
  onChange,
  onBlurField,
  nameRef,
}: ProjectFormFieldsProps) {
  const baseId = useId();
  const ids = {
    name: `${baseId}-name`,
    nameMessage: `${baseId}-name-message`,
    description: `${baseId}-description`,
    descriptionMessage: `${baseId}-description-message`,
    region: `${baseId}-region`,
    regionMessage: `${baseId}-region-message`,
  };

  return (
    <FieldGroup>
      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor={ids.name}>Nom</FieldLabel>
        <Input
          id={ids.name}
          ref={nameRef}
          name="name"
          value={values.name}
          onChange={(event) => onChange({ name: event.target.value })}
          onBlur={() => onBlurField?.("name")}
          placeholder="Boutique en ligne"
          autoComplete="off"
          required
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={ids.nameMessage}
        />
        {errors.name ? (
          <FieldError id={ids.nameMessage}>{errors.name}</FieldError>
        ) : (
          <FieldDescription id={ids.nameMessage}>
            De {NAME_MIN_LENGTH} à {NAME_MAX_LENGTH} caractères, unique dans l’espace de travail.
          </FieldDescription>
        )}
      </Field>

      <Field data-invalid={errors.description ? true : undefined}>
        <FieldLabel htmlFor={ids.description}>
          Description
          <span className="font-normal text-muted-foreground">(facultatif)</span>
        </FieldLabel>
        <Textarea
          id={ids.description}
          name="description"
          value={values.description}
          onChange={(event) => onChange({ description: event.target.value })}
          onBlur={() => onBlurField?.("description")}
          placeholder="À quoi sert ce projet ?"
          className="max-h-40"
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={ids.descriptionMessage}
        />
        {errors.description ? (
          <FieldError id={ids.descriptionMessage}>{errors.description}</FieldError>
        ) : (
          <FieldDescription id={ids.descriptionMessage}>
            {DESCRIPTION_MAX_LENGTH} caractères au maximum.
          </FieldDescription>
        )}
      </Field>

      <FieldSet>
        <FieldLegend variant="label">Couleur</FieldLegend>
        <div className="flex items-center gap-4">
          <ProjectAvatar
            name={values.name.trim() || "Projet"}
            color={values.color}
            size="lg"
          />
          <ProjectColorPicker
            value={values.color}
            onChange={(color) => onChange({ color })}
          />
        </div>
        {errors.color ? <FieldError>{errors.color}</FieldError> : null}
      </FieldSet>

      <Field data-invalid={errors.region ? true : undefined}>
        <FieldLabel htmlFor={ids.region}>Région</FieldLabel>
        <Select
          value={values.region}
          onValueChange={(value) => {
            const region = parseRegion(value);
            if (region) onChange({ region });
          }}
        >
          <SelectTrigger
            id={ids.region}
            className="w-full"
            aria-invalid={errors.region ? true : undefined}
            aria-describedby={ids.regionMessage}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REGIONS.map((region) => (
              <SelectItem key={region} value={region}>
                {REGION_LABELS[region]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.region ? (
          <FieldError id={ids.regionMessage}>{errors.region}</FieldError>
        ) : (
          <FieldDescription id={ids.regionMessage}>
            Là où sont hébergés les services du projet.
          </FieldDescription>
        )}
      </Field>
    </FieldGroup>
  );
}
