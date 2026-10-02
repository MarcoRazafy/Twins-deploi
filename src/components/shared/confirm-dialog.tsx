"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  /** Defaults to "Supprimer" for the danger tone, "Confirmer" otherwise. */
  confirmLabel?: string;
  /** Defaults to "Annuler". */
  cancelLabel?: string;
  /** "danger" for destructive actions: warning icon and destructive button. */
  tone?: "danger" | "default";
  /**
   * When set, the user must type this text exactly (e.g. the project name)
   * before the confirm button is enabled.
   */
  confirmText?: string;
  /** Keeps the dialog open and busy, typically `mutation.isPending`. */
  loading?: boolean;
  /**
   * The dialog does not close by itself: close it from here once the action
   * succeeded. If a promise is returned, the dialog stays busy until it
   * settles, so `loading` is optional with async handlers.
   */
  onConfirm: () => void | Promise<unknown>;
  /** Extra content between the description and the buttons. */
  children?: ReactNode;
}

interface ConfirmFormProps
  extends Pick<
    ConfirmDialogProps,
    "title" | "description" | "confirmText" | "children"
  > {
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  busy: boolean;
  onSubmit: () => void;
}

// Rendered inside the dialog content, which unmounts on close: the typed
// confirmation therefore starts empty every time the dialog opens.
function ConfirmForm({
  title,
  description,
  confirmText,
  children,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  onSubmit,
}: ConfirmFormProps) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const confirmed = !confirmText || typed.trim() === confirmText;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmed && !busy) onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <AlertDialogHeader>
        {danger ? (
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlert />
          </AlertDialogMedia>
        ) : null}
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>

      {children}

      {confirmText ? (
        <div className="grid gap-2">
          <Label
            htmlFor={inputId}
            className="block leading-normal font-normal text-muted-foreground"
          >
            Saisissez{" "}
            <span className="font-mono text-[13px] font-medium text-foreground select-all">
              {confirmText}
            </span>{" "}
            pour confirmer
          </Label>
          <Input
            id={inputId}
            data-confirm-input=""
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      ) : null}

      <AlertDialogFooter>
        <AlertDialogCancel type="button" disabled={busy}>
          {cancelLabel}
        </AlertDialogCancel>
        <Button
          type="submit"
          variant={danger ? "destructive" : "default"}
          disabled={!confirmed || busy}
          aria-busy={busy || undefined}
          aria-label={busy ? confirmLabel : undefined}
          className="relative"
        >
          {/* The spinner replaces the label in place: the width never changes. */}
          <span className={cn(busy && "invisible")}>{confirmLabel}</span>
          {busy ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <Spinner aria-label="Chargement" />
            </span>
          ) : null}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}

/**
 * Confirmation for an action that deserves a second thought. Destructive
 * actions use `tone="danger"`; deleting a project, a service or a database
 * also passes `confirmText` so the name has to be typed.
 *
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     tone="danger"
 *     title="Supprimer le projet"
 *     description="Cette action est irréversible."
 *     confirmText={project.name}
 *     loading={remove.isPending}
 *     onConfirm={() => remove.mutate(project.id, { onSuccess: () => setOpen(false) })}
 *   />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Annuler",
  tone = "default",
  confirmText,
  loading = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const busy = loading || pending;
  const danger = tone === "danger";

  async function handleConfirm() {
    const result = onConfirm();
    if (!(result instanceof Promise)) return;
    setPending(true);
    try {
      await result;
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Escape and "Annuler" must not dismiss an action that is running.
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent
        className={cn((confirmText || children) && "sm:max-w-md")}
        onOpenAutoFocus={(event) => {
          // Radix focuses "Annuler" by default. With a typed confirmation the
          // field is the first thing the user needs.
          const container = event.currentTarget;
          if (!(container instanceof HTMLElement)) return;
          const input = container.querySelector<HTMLInputElement>("[data-confirm-input]");
          if (!input) return;
          event.preventDefault();
          input.focus();
        }}
      >
        <ConfirmForm
          title={title}
          description={description}
          confirmText={confirmText}
          confirmLabel={confirmLabel ?? (danger ? "Supprimer" : "Confirmer")}
          cancelLabel={cancelLabel}
          danger={danger}
          busy={busy}
          onSubmit={handleConfirm}
        >
          {children}
        </ConfirmForm>
      </AlertDialogContent>
    </AlertDialog>
  );
}
