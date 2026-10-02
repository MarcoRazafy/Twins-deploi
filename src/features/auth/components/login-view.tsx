"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn } from "lucide-react";
import { AnimatePresence } from "motion/react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/lib/api";
import { useLogin, useSession } from "@/lib/queries";

import { resolveNextPath, SETUP_PATH } from "../lib/paths";
import { AuthPasswordField, AuthTextField, FormAlert, focusField } from "./auth-fields";
import { AuthCard, AuthShell, FORM_SHAPES, FormSkeleton } from "./auth-layout";

interface FieldErrors {
  email?: string;
  password?: string;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = resolveNextPath(searchParams.get("next"));
  const session = useSession();
  const login = useLogin();
  const formRef = useRef<HTMLFormElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const status = session.data?.status;

  // Someone already signed in, or with no account to sign in to, has no business
  // here. While a sign-in is under way the form takes care of the navigation.
  useEffect(() => {
    if (submitting) return;
    if (status === "authenticated") router.replace(destination);
    else if (status === "setup_required") router.replace(SETUP_PATH);
  }, [status, submitting, destination, router]);

  // Placeholders until the session is known (or while leaving); a failed check
  // still lets the visitor try, the sign-in call reports what is wrong.
  const ready = status === "unauthenticated" || session.isError || submitting;
  if (!ready) return <FormSkeleton shape={FORM_SHAPES.login} />;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const trimmedEmail = email.trim();
    const errors: FieldErrors = {
      email: trimmedEmail ? undefined : "Saisissez votre adresse e-mail.",
      password: password ? undefined : "Saisissez votre mot de passe.",
    };
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      focusField(formRef.current, errors.email ? "email" : "password");
      return;
    }

    setFormError(null);
    setSubmitting(true);
    login.mutate(
      { email: trimmedEmail, password },
      {
        onSuccess: (result) => {
          if (result.status === "authenticated") {
            // A full navigation rather than router.replace: the live-update stream opens once, when
            // the app loads, and a load without a session leaves it closed until the next load.
            window.location.replace(destination);
            return;
          }
          // Anything else is handled by the effect above (account to create) or is a refusal.
          setSubmitting(false);
          if (result.status === "unauthenticated") {
            setFormError("Connexion impossible. Vérifiez vos identifiants.");
          }
        },
        onError: (error) => {
          setSubmitting(false);
          setFormError(getErrorMessage(error));
          focusField(formRef.current, "email");
        },
      },
    );
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      aria-busy={submitting}
      className="flex flex-col gap-5"
    >
      <AuthTextField
        id="login-email"
        name="email"
        type="email"
        label="E-mail"
        autoComplete="username"
        autoCapitalize="none"
        autoFocus
        inputMode="email"
        spellCheck={false}
        readOnly={submitting}
        value={email}
        onValueChange={(value) => {
          setEmail(value);
          setFieldErrors((current) => (current.email ? { ...current, email: undefined } : current));
        }}
        error={fieldErrors.email}
      />
      <AuthPasswordField
        id="login-password"
        name="password"
        label="Mot de passe"
        autoComplete="current-password"
        readOnly={submitting}
        value={password}
        onValueChange={(value) => {
          setPassword(value);
          setFieldErrors((current) =>
            current.password ? { ...current, password: undefined } : current,
          );
        }}
        error={fieldErrors.password}
      />

      <AnimatePresence initial={false} mode="wait">
        {formError ? <FormAlert key={formError}>{formError}</FormAlert> : null}
      </AnimatePresence>

      <Button type="submit" size="lg" className="h-10 w-full" disabled={submitting}>
        {submitting ? (
          <Spinner data-icon="inline-start" role="presentation" aria-hidden="true" />
        ) : (
          <LogIn data-icon="inline-start" />
        )}
        Se connecter
      </Button>
    </form>
  );
}

export function LoginView() {
  return (
    <AuthShell>
      <AuthCard variant="login">
        {/* useSearchParams needs a boundary of its own so the card stays in the server HTML. */}
        <Suspense fallback={<FormSkeleton shape={FORM_SHAPES.login} />}>
          <LoginForm />
        </Suspense>
      </AuthCard>
    </AuthShell>
  );
}
