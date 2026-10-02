"use client";

import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface SettingsCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  dirty: boolean;
  saving: boolean;
  onSubmit: () => void;
  onReset: () => void;
  saveLabel?: string;
}

/** A group of fields saved together: dirty hint, cancel and save in the footer. */
export function SettingsCard({
  title,
  description,
  children,
  dirty,
  saving,
  onSubmit,
  onReset,
  saveLabel = "Enregistrer",
}: SettingsCardProps) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (dirty && !saving) onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-xl border bg-card">
      <div className="space-y-5 p-4 @md:p-5">
        {title ? (
          <div>
            <h4 className="text-sm font-medium">{title}</h4>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-b-xl border-t bg-secondary/30 px-4 py-3 @md:px-5">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {dirty ? "Modifications non enregistrées" : "Aucune modification"}
        </p>
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={saving}>
              Annuler
            </Button>
          ) : null}
          <Button
            type="submit"
            size="sm"
            variant={dirty ? "default" : "secondary"}
            disabled={!dirty || saving}
          >
            {saving ? <Spinner /> : null}
            {saveLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
