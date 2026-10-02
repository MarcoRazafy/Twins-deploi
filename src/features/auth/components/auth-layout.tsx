"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

import { Logo } from "@/components/shared/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated } from "@/hooks/use-hydrated";
import { pageEnter } from "@/lib/motion";

const AUTH_COPY = {
  login: {
    title: "Connexion",
    description: "Saisissez vos identifiants pour accéder à votre espace de travail.",
  },
  setup: {
    title: "Créer le compte propriétaire",
    description:
      "Première ouverture de cette instance : ce compte gère la plateforme et pourra inviter d’autres membres.",
  },
} as const;

export type AuthVariant = keyof typeof AUTH_COPY;

/** Per field: does a helper line sit under the input? Keeps the skeleton as tall as the real form. */
export const FORM_SHAPES = {
  login: [false, false],
  setup: [false, false, true, false],
} as const satisfies Record<AuthVariant, readonly boolean[]>;

/**
 * Full-screen frame of the sign-in screens: the dotted background of the 404
 * page, the logo and the page-enter motion. A page that arrives as server
 * HTML is shown as is; only a client-side arrival (the session gate sending
 * the visitor here) plays the entrance.
 *
 * The card hangs from a fixed offset instead of being centred vertically: an
 * error callout makes it taller, and a centred card would slide every field up.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();

  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-background bg-dot-grid px-4 pt-[clamp(2.5rem,16vh,9rem)] pb-10">
      {/* Fades the dots out towards the edges and adds a soft brand glow behind the card. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--background)_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[clamp(2.5rem,16vh,9rem)] left-1/2 size-72 -translate-x-1/2 -translate-y-1/4 rounded-full bg-brand-600/15 blur-3xl"
      />
      <motion.div
        variants={pageEnter}
        initial={hydrated ? "hidden" : false}
        animate="visible"
        className="relative flex w-full max-w-sm flex-col items-center gap-6"
      >
        <Logo />
        {children}
      </motion.div>
    </main>
  );
}

/** The card of a sign-in screen: title, short explanation and the form. */
export function AuthCard({ variant, children }: { variant: AuthVariant; children: ReactNode }) {
  const { title, description } = AUTH_COPY[variant];
  const titleId = `auth-title-${variant}`;

  return (
    <section
      aria-labelledby={titleId}
      className="surface-highlight w-full rounded-xl border bg-card p-5 sm:p-6"
    >
      <header className="mb-5 grid gap-1.5">
        <h1 id={titleId} className="text-xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

/** Placeholder with the geometry of the form: label, 40 px input, optional helper line, button. */
export function FormSkeleton({ shape }: { shape: readonly boolean[] }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      {shape.map((hasHint, index) => (
        <div key={index} className="flex flex-col gap-2">
          <div className="flex h-[19.25px] items-center">
            <Skeleton className="h-3.5 w-20" />
          </div>
          <Skeleton className="h-10 w-full rounded-lg" />
          {hasHint ? (
            <div className="flex h-[21px] items-center">
              <Skeleton className="h-3.5 w-48 max-w-full" />
            </div>
          ) : null}
        </div>
      ))}
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  );
}

/** Whole-screen fallback for the `<Suspense>` boundary of the two pages. */
export function AuthSkeleton({ variant = "login" }: { variant?: AuthVariant }) {
  return (
    <AuthShell>
      <AuthCard variant={variant}>
        <FormSkeleton shape={FORM_SHAPES[variant]} />
      </AuthCard>
    </AuthShell>
  );
}
