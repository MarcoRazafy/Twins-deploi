import type { Metadata } from "next";
import Link from "next/link";

import { LogoMark } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Page introuvable" };

/** 404: rendered by the root layout, so it works outside the platform shell. */
export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background bg-dot-grid px-4 py-16 text-center">
      {/* Fades the dot grid out towards the edges and adds a soft brand glow behind the number. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--background)_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 size-72 -translate-x-1/2 -translate-y-3/4 rounded-full bg-brand-600/15 blur-3xl"
      />

      <div className="relative flex flex-col items-center">
        <LogoMark className="size-11" />
        <p
          aria-hidden="true"
          className="mt-8 bg-linear-to-b from-foreground to-foreground/15 bg-clip-text text-7xl font-semibold tracking-tighter text-transparent tabular sm:text-8xl"
        >
          404
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">Page introuvable</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          La page que vous cherchez n’existe pas ou a été déplacée. Vérifiez l’adresse ou revenez au
          dashboard.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button asChild size="lg">
            <Link href={routes.dashboard()}>Retour au dashboard</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={routes.projects()}>Voir les projets</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
