"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, UserPlus } from "lucide-react";
import { AnimatePresence } from "motion/react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage, isApiError } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { useSession, useSetup } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { LOGIN_PATH } from "../lib/paths";
import { AuthPasswordField, AuthTextField, FormAlert, focusField } from "./auth-fields";
import { AuthCard, AuthShell, FORM_SHAPES, FormSkeleton } from "./auth-layout";

/** Same floor as the server (`SetupInput.password`). */
const PASSWORD_MIN_LENGTH = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** In tab order: the first invalid one receives the focus. */
const FIELDS = ["name", "email", "password", "confirmation"] as const;
type FieldName = (typeof FIELDS)[number];
type Values = Record<FieldName, string>;
type FieldErrors = Partial<Record<FieldName, string>>;

function isFieldName(value: string): value is FieldName {
  return FIELDS.some((field) => field === value);
}

function validate(values: Values): FieldErrors {
  const errors: FieldErrors = {};
  const email = values.email.trim();

  if (!values.name.trim()) errors.name = "Saisissez votre nom.";
  if (!email) errors.email = "Saisissez votre adresse e-mail.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Cette adresse e-mail n’est pas valide.";
  if (values.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (!values.confirmation) errors.confirmation = "Confirmez votre mot de passe.";
  else if (values.confirmation !== values.password) {
    errors.confirmation = "Les mots de passe ne correspondent pas.";
  }
  return errors;
}

/** Live helper under the password: what is still missing, then a confirmation. */
function PasswordHint({ length, invalid }: { length: number; invalid: boolean }) {
  const missing = PASSWORD_MIN_LENGTH - length;

  if (missing <= 0) {
    return (
      <span aria-live="polite" className="flex items-center gap-1.5 text-success">
        <Check className="size-4 shrink-0" aria-hidden="true" />
        Longueur suffisante.
      </span>
    );
  }
  return (
    <span aria-live="polite" className={cn("tabular", invalid && "text-destructive")}>
      {length === 0
        ? `${PASSWORD_MIN_LENGTH} caractères minimum.`
        : `Encore ${pluralize(missing, "caractère")} (minimum ${PASSWORD_MIN_LENGTH}).`}
    </span>
  );
}

const EMPTY_VALUES: Values = { name: "", email: "", password: "", confirmation: "" };

function SetupForm() {
  const router = useRouter();
  const session = useSession();
  const setup = useSetup();
  const formRef = useRef<HTMLFormElement>(null);

  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const status = session.data?.status;

  // The account can only be created once: after that this screen has no purpose.
  // While the creation is under way the form takes care of the navigation.
  useEffect(() => {
    if (submitting) return;
    if (status === "authenticated") router.replace(routes.dashboard());
    else if (status === "unauthenticated") router.replace(LOGIN_PATH);
  }, [status, submitting, router]);

  // Placeholders until the session is known (or while leaving); a failed check
  // still lets the visitor try, the server refuses a second owner anyway.
  const ready = status === "setup_required" || session.isError || submitting;
  if (!ready) return <FormSkeleton shape={FORM_SHAPES.setup} />;

  const errors = validate(values);
  // Client errors wait for a blur or a submit attempt; the server's come with the response.
  const clientError = (field: FieldName) =>
    touched[field] || attempted ? errors[field] : undefined;
  const fieldError = (field: FieldName) => clientError(field) ?? serverErrors[field];

  const update = (field: FieldName) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };
  const markTouched = (field: FieldName) => () => {
    setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setAttempted(true);
    const firstInvalid = FIELDS.find((field) => errors[field]);
    if (firstInvalid) {
      focusField(formRef.current, firstInvalid);
      return;
    }

    setFormError(null);
    setServerErrors({});
    setSubmitting(true);
    setup.mutate(
      { name: values.name.trim(), email: values.email.trim(), password: values.password },
      {
        onSuccess: (result) => {
          if (result.status === "authenticated") {
            // A full navigation rather than router.replace: the live-update stream opens once, when
            // the app loads, and a load without a session leaves it closed until the next load.
            window.location.replace(routes.dashboard());
            return;
          }
          // The effect above sends the visitor wherever the new status says.
          setSubmitting(false);
        },
        onError: (error) => {
          setSubmitting(false);
          const field = isApiError(error) && error.field ? error.field : null;
          if (field && isFieldName(field)) {
            setServerErrors({ [field]: getErrorMessage(error) });
            focusField(formRef.current, field);
          } else {
            setFormError(getErrorMessage(error));
            focusField(formRef.current, "name");
          }
        },
      },
    );
  };

  const passwordError = clientError("password");

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      aria-busy={submitting}
      className="flex flex-col gap-5"
    >
      <AuthTextField
        id="setup-name"
        name="name"
        label="Nom"
        autoComplete="name"
        autoFocus
        readOnly={submitting}
        value={values.name}
        onValueChange={update("name")}
        onBlur={markTouched("name")}
        error={fieldError("name")}
      />
      <AuthTextField
        id="setup-email"
        name="email"
        type="email"
        label="E-mail"
        autoComplete="email"
        autoCapitalize="none"
        inputMode="email"
        spellCheck={false}
        readOnly={submitting}
        value={values.email}
        onValueChange={update("email")}
        onBlur={markTouched("email")}
        error={fieldError("email")}
      />
      <AuthPasswordField
        id="setup-password"
        name="password"
        label="Mot de passe"
        autoComplete="new-password"
        readOnly={submitting}
        value={values.password}
        onValueChange={update("password")}
        onBlur={markTouched("password")}
        error={serverErrors.password}
        invalid={Boolean(passwordError ?? serverErrors.password)}
        hint={<PasswordHint length={values.password.length} invalid={Boolean(passwordError)} />}
      />
      <AuthPasswordField
        id="setup-confirmation"
        name="confirmation"
        label="Confirmation"
        placeholder="Saisissez-le à nouveau"
        autoComplete="new-password"
        revealNoun="la confirmation"
        readOnly={submitting}
        value={values.confirmation}
        onValueChange={update("confirmation")}
        onBlur={markTouched("confirmation")}
        error={fieldError("confirmation")}
      />

      <AnimatePresence initial={false} mode="wait">
        {formError ? <FormAlert key={formError}>{formError}</FormAlert> : null}
      </AnimatePresence>

      <Button type="submit" size="lg" className="h-10 w-full" disabled={submitting}>
        {submitting ? (
          <Spinner data-icon="inline-start" role="presentation" aria-hidden="true" />
        ) : (
          <UserPlus data-icon="inline-start" />
        )}
        Créer le compte
      </Button>
    </form>
  );
}

export function SetupView() {
  return (
    <AuthShell>
      <AuthCard variant="setup">
        <SetupForm />
      </AuthCard>
    </AuthShell>
  );
}
