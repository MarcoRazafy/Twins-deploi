"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fadeUp } from "@/lib/motion";

type NativeInputProps = Omit<
  ComponentProps<"input">,
  "id" | "value" | "onChange" | "className" | "aria-invalid" | "aria-describedby"
>;

export interface AuthFieldProps extends NativeInputProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Inline error: replaces the hint and marks the field invalid. */
  error?: string;
  /** Helper line under the field. */
  hint?: ReactNode;
  /** Marks the field invalid when the reason is already readable in `hint`. */
  invalid?: boolean;
}

function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (error) return <FieldError id={id}>{error}</FieldError>;
  if (hint) return <FieldDescription id={id}>{hint}</FieldDescription>;
  return null;
}

/** Text input at the 40 px height of the sign-in screens. */
export function AuthTextField({
  id,
  label,
  value,
  onValueChange,
  error,
  hint,
  invalid,
  ...inputProps
}: AuthFieldProps) {
  const isInvalid = invalid ?? Boolean(error);
  const messageId = `${id}-message`;

  return (
    <Field data-invalid={isInvalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...inputProps}
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={isInvalid || undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className="h-10"
      />
      <FieldMessage id={messageId} error={error} hint={hint} />
    </Field>
  );
}

export interface AuthPasswordFieldProps extends AuthFieldProps {
  /** What the eye button reveals, for its accessible name ("la confirmation"). */
  revealNoun?: string;
}

/** Password input with a show/hide toggle. */
export function AuthPasswordField({
  id,
  label,
  value,
  onValueChange,
  error,
  hint,
  invalid,
  revealNoun = "le mot de passe",
  ...inputProps
}: AuthPasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const isInvalid = invalid ?? Boolean(error);
  const messageId = `${id}-message`;
  const toggleLabel = `${visible ? "Masquer" : "Afficher"} ${revealNoun}`;

  return (
    <Field data-invalid={isInvalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup className="h-10">
        <InputGroupInput
          {...inputProps}
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          aria-invalid={isInvalid || undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className="h-full"
        />
        <InputGroupAddon align="inline-end">
          <Tooltip>
            <TooltipTrigger asChild>
              <InputGroupButton
                size="icon-sm"
                aria-label={toggleLabel}
                // Keeps the caret in the field when the button is clicked with a mouse.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setVisible((current) => !current)}
              >
                {visible ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </TooltipTrigger>
            <TooltipContent>{toggleLabel}</TooltipContent>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
      <FieldMessage id={messageId} error={error} hint={hint} />
    </Field>
  );
}

/**
 * Error callout of a form. Key it on its message: a failure that repeats
 * remounts it, which is what makes a screen reader announce it again.
 */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <motion.div
      role="alert"
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 wrap-break-word">{children}</p>
    </motion.div>
  );
}

/** Focuses the input called `name` inside `form` (for the first invalid field). */
export function focusField(form: HTMLFormElement | null, name: string): void {
  form?.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.focus();
}
