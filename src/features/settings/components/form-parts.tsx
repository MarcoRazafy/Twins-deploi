"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { FormEvent, ReactNode } from "react";

import { ErrorState } from "@/components/shared/error-state";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { FormControls } from "../hooks/use-settings-form";

interface FormFieldProps {
  id: string;
  label: string;
  description?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}

/** Label, control, help text and the validation error, in the order of the design system. */
export function FormField({ id, label, description, error, children, className }: FormFieldProps) {
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {description ? <FieldDescription id={`${id}-help`}>{description}</FieldDescription> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  );
}

/** Describes a field for assistive technology: its help text and, when shown, its error. */
export function describedBy(id: string, hasDescription: boolean, error?: string): string | undefined {
  const ids = [hasDescription ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

interface UnitInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  unit: string;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}

/** Numeric text input with its unit attached on the right. */
export function UnitInput({ id, value, onChange, onBlur, unit, invalid, describedBy: described, className }: UnitInputProps) {
  return (
    <InputGroup className={className}>
      <InputGroupInput
        id={id}
        value={value}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={described}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{unit}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

interface SwitchRowProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function SwitchRow({ id, label, description, checked, onCheckedChange, disabled }: SwitchRowProps) {
  return (
    <Field orientation="horizontal" className="items-start justify-between gap-4">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
    </Field>
  );
}

interface FormCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** Left of the footer while nothing was changed. */
  hint: string;
  form: FormControls;
  children: ReactNode;
  className?: string;
}

/**
 * A settings card that is also a form: Enter submits, the footer carries the
 * dirty state, "Annuler" restores the saved values and "Enregistrer" saves.
 */
export function FormCard({ title, description, hint, form, children, className }: FormCardProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.submit();
  }

  return (
    <form noValidate onSubmit={handleSubmit} aria-busy={form.saving}>
      <SectionCard
        title={title}
        description={description}
        className={className}
        footer={
          <>
            <span
              className={cn("text-xs", form.dirty && "text-warning")}
              aria-live="polite"
            >
              {form.dirty ? "Modifications non enregistrées" : hint}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={!form.dirty || form.saving} onClick={form.reset}>
                Annuler
              </Button>
              <Button type="submit" disabled={!form.dirty || form.saving}>
                {form.saving ? <Spinner data-icon="inline-start" /> : null}
                Enregistrer
              </Button>
            </div>
          </>
        }
      >
        {children}
      </SectionCard>
    </form>
  );
}

export function FormCardSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div aria-busy className="rounded-xl border bg-card">
      <div className="space-y-2 p-4 sm:p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-4 px-4 pb-5 sm:px-5">
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-full sm:w-72" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t bg-secondary/40 px-4 py-3 sm:px-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-40" />
      </div>
    </div>
  );
}

interface QueryBoundaryProps<T> {
  query: UseQueryResult<T, Error>;
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
}

/** Skeleton while loading, an error with retry, then the data (kept on screen during a refetch). */
export function QueryBoundary<T>({ query, skeleton, children }: QueryBoundaryProps<T>) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  return <>{skeleton}</>;
}
