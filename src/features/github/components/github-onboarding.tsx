"use client";

import { Check, Download, GitBranch, Rocket } from "lucide-react";

import { GithubIcon } from "@/components/icons/brand-icons";
import { Stagger, StaggerItem } from "@/components/shared/motion";
import type { IconComponent } from "@/components/shared/render-icon";
import { Button } from "@/components/ui/button";

interface Benefit {
  icon: IconComponent;
  title: string;
  description: string;
}

const BENEFITS: readonly Benefit[] = [
  {
    icon: Download,
    title: "Importez vos dépôts",
    description: "Publics ou privés, un dépôt devient un service en quelques secondes.",
  },
  {
    icon: Rocket,
    title: "Déploiement à chaque push",
    description: "Un push sur la branche choisie lance un nouveau build, sans rien faire.",
  },
  {
    icon: GitBranch,
    title: "Choix de la branche",
    description: "Déployez main, develop ou n’importe quelle branche, et changez à tout moment.",
  },
];

const PERMISSIONS = [
  { name: "Contents", detail: "lecture seule, pour récupérer le code à construire" },
  { name: "Metadata", detail: "lecture seule, pour lister vos dépôts et vos branches" },
] as const;

export interface GithubOnboardingProps {
  onConnect: () => void;
}

/** Shown while GitHub is not connected: what it brings, what is asked, how to start. */
export function GithubOnboarding({ onConnect }: GithubOnboardingProps) {
  return (
    <section
      aria-labelledby="github-onboarding-title"
      className="surface-highlight mx-auto w-full max-w-xl rounded-xl border bg-card p-5 sm:p-8"
    >
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-secondary ring-1 ring-border-strong">
          <GithubIcon aria-hidden className="size-7" />
        </div>
        <h2
          id="github-onboarding-title"
          className="mt-4 text-lg font-semibold tracking-tight"
        >
          Connectez votre compte GitHub
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Reliez vos dépôts à TwinsDeploi pour les importer et les déployer automatiquement.
        </p>
      </div>

      <Stagger as="ul" className="mt-6 space-y-3">
        {BENEFITS.map((benefit) => (
          <StaggerItem as="li" key={benefit.title} className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600/15 text-brand-400">
              <benefit.icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{benefit.title}</span>
              <span className="block text-sm text-muted-foreground">{benefit.description}</span>
            </span>
          </StaggerItem>
        ))}
      </Stagger>

      <div className="mt-6 rounded-lg bg-secondary px-3 py-3 text-sm">
        <p className="font-medium">Permissions demandées</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Un jeton d’accès personnel à portée limitée, sans droit d’écriture.
        </p>
        <ul className="mt-2.5 space-y-1.5">
          {PERMISSIONS.map((permission) => (
            <li key={permission.name} className="flex items-start gap-2 text-xs">
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>
                <span className="font-mono text-[12px] text-foreground">{permission.name}</span>
                <span className="text-muted-foreground"> : {permission.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 flex justify-center">
        <Button type="button" size="lg" className="w-full sm:w-auto" onClick={onConnect}>
          <GithubIcon data-icon="inline-start" />
          Connecter GitHub
        </Button>
      </div>
    </section>
  );
}
