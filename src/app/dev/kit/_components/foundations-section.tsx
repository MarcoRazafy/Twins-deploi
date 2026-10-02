"use client";

import { cn } from "@/lib/utils";

import { KitExample, KitLabel, KitSection } from "./kit-section";
import { useCssVariable } from "./use-client-value";

interface Token {
  /** Utility that paints the swatch. */
  swatch: string;
  /** Utility to use in components. */
  utility: string;
  role: string;
  /** Custom property holding the value, when there is one on :root. */
  variable?: string;
}

const SURFACES: Token[] = [
  { swatch: "bg-background", utility: "bg-background", role: "Fond d’app, canvas", variable: "--background" },
  { swatch: "bg-card", utility: "bg-card", role: "Cartes, panneaux", variable: "--card" },
  { swatch: "bg-secondary", utility: "bg-secondary", role: "Champs, lignes en relief", variable: "--secondary" },
  { swatch: "bg-accent", utility: "bg-accent", role: "Survol, élément actif", variable: "--accent" },
  { swatch: "bg-popover", utility: "bg-popover", role: "Menus, toasts", variable: "--popover" },
];

const TEXTS: Token[] = [
  { swatch: "bg-foreground", utility: "text-foreground", role: "Titres, valeurs", variable: "--foreground" },
  { swatch: "bg-muted-foreground", utility: "text-muted-foreground", role: "Descriptions, libellés", variable: "--muted-foreground" },
  { swatch: "bg-subtle", utility: "text-subtle", role: "Décoratif uniquement", variable: "--subtle-foreground" },
  { swatch: "bg-border", utility: "border-border", role: "Bordure par défaut", variable: "--border" },
  { swatch: "bg-border-strong", utility: "border-border-strong", role: "Survol, champs", variable: "--border-strong" },
];

const STATUSES: Token[] = [
  { swatch: "bg-primary", utility: "bg-primary", role: "Action principale", variable: "--primary" },
  { swatch: "bg-success", utility: "text-success", role: "En ligne, valide", variable: "--success" },
  { swatch: "bg-info", utility: "text-info", role: "En cours", variable: "--info" },
  { swatch: "bg-warning", utility: "text-warning", role: "Attention requise", variable: "--warning" },
  { swatch: "bg-destructive", utility: "text-destructive", role: "Échec, suppression", variable: "--destructive" },
];

const BRAND_SCALE = [
  ["50", "bg-brand-50"],
  ["100", "bg-brand-100"],
  ["200", "bg-brand-200"],
  ["300", "bg-brand-300"],
  ["400", "bg-brand-400"],
  ["500", "bg-brand-500"],
  ["600", "bg-brand-600"],
  ["700", "bg-brand-700"],
  ["800", "bg-brand-800"],
  ["900", "bg-brand-900"],
  ["950", "bg-brand-950"],
] as const;

const CHART_COLORS = [
  ["chart-1", "bg-chart-1"],
  ["chart-2", "bg-chart-2"],
  ["chart-3", "bg-chart-3"],
  ["chart-4", "bg-chart-4"],
  ["chart-5", "bg-chart-5"],
] as const;

const TYPE_SCALE = [
  { role: "Titre de page", classes: "text-xl font-semibold tracking-tight sm:text-2xl", sample: "Déploiements" },
  { role: "Titre de section", classes: "text-base font-medium", sample: "Variables d’environnement" },
  { role: "Titre de sous-section", classes: "text-sm font-medium", sample: "Domaine personnalisé" },
  { role: "Corps", classes: "text-sm", sample: "Le service redémarre à chaque changement de configuration." },
  { role: "Secondaire", classes: "text-sm text-muted-foreground", sample: "Dernier déploiement il y a 3 min par Marco Razafy" },
  { role: "Légende", classes: "text-xs text-muted-foreground", sample: "Europe de l’Ouest · Paris" },
  { role: "Valeur KPI", classes: "text-2xl font-semibold tabular", sample: "1 284" },
  { role: "Code", classes: "font-mono text-[13px]", sample: "postgresql://postgres:••••@postgres.railway.internal:5432/railway" },
] as const;

function Swatch({ token }: { token: Token }) {
  const value = useCssVariable(token.variable ?? "--unset");

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className={cn("size-10 shrink-0 rounded-lg border border-border-strong", token.swatch)}
      />
      <div className="min-w-0">
        <p className="truncate font-mono text-xs">{token.utility}</p>
        <p className="truncate text-xs text-muted-foreground">
          {token.role}
          {value ? ` · ${value}` : ""}
        </p>
      </div>
    </div>
  );
}

function TokenGrid({ tokens }: { tokens: Token[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {tokens.map((token) => (
        <Swatch key={token.utility} token={token} />
      ))}
    </div>
  );
}

export function FoundationsSection() {
  return (
    <KitSection
      id="fondations"
      title="Fondations"
      description="Palette, typographie et surfaces. Les composants n’utilisent que ces utilitaires : aucune couleur n’est écrite en dur."
    >
      <KitExample title="Couleurs" code="src/app/globals.css" bodyClassName="space-y-5">
        <div className="space-y-2.5">
          <KitLabel>Surfaces, de la plus basse à la plus haute</KitLabel>
          <TokenGrid tokens={SURFACES} />
        </div>
        <div className="space-y-2.5">
          <KitLabel>Texte et bordures</KitLabel>
          <TokenGrid tokens={TEXTS} />
        </div>
        <div className="space-y-2.5">
          <KitLabel>Action et statuts</KitLabel>
          <TokenGrid tokens={STATUSES} />
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-2.5">
            <KitLabel>Marque, de brand-50 à brand-950</KitLabel>
            <div className="flex overflow-hidden rounded-lg border border-border-strong">
              {BRAND_SCALE.map(([step, className]) => (
                <div key={step} className="min-w-0 flex-1">
                  <div className={cn("h-10", className)} />
                  <p className="truncate bg-card py-1 text-center font-mono text-[10px] text-muted-foreground">
                    {step}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2.5">
            <KitLabel>Séries de graphiques</KitLabel>
            <div className="flex overflow-hidden rounded-lg border border-border-strong">
              {CHART_COLORS.map(([name, className]) => (
                <div key={name} className="min-w-0 flex-1">
                  <div className={cn("h-10", className)} />
                  <p className="truncate bg-card py-1 text-center font-mono text-[10px] text-muted-foreground">
                    {name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </KitExample>

      <KitExample title="Typographie" code="Inter · JetBrains Mono" bodyClassName="divide-y p-0 sm:p-0">
        {TYPE_SCALE.map((item) => (
          <div
            key={item.role}
            className="grid grid-cols-1 gap-x-6 gap-y-1 px-4 py-3 sm:px-5 md:grid-cols-[11rem_1fr_auto] md:items-center"
          >
            <p className="text-xs text-muted-foreground">{item.role}</p>
            <p className={cn("min-w-0 truncate", item.classes)}>{item.sample}</p>
            <code className="truncate font-mono text-xs text-muted-foreground">{item.classes}</code>
          </div>
        ))}
      </KitExample>

      <KitExample title="Surfaces et élévation" code="DESIGN.md §3">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <div className="flex h-24 items-end rounded-xl border bg-card p-3 text-sm">Carte</div>
            <code className="block truncate font-mono text-xs text-muted-foreground">
              rounded-xl border bg-card
            </code>
          </div>
          <div className="space-y-2">
            <div className="surface-highlight flex h-24 cursor-pointer items-end rounded-xl border bg-card p-3 text-sm transition-colors hover:border-border-strong hover:bg-secondary/40">
              Carte cliquable
            </div>
            <code className="block truncate font-mono text-xs text-muted-foreground">
              hover:border-border-strong
            </code>
          </div>
          <div className="space-y-2">
            <div className="ring-brand-glow flex h-24 items-end rounded-xl border bg-card p-3 text-sm">
              Carte sélectionnée
            </div>
            <code className="block truncate font-mono text-xs text-muted-foreground">
              ring-brand-glow
            </code>
          </div>
          <div className="space-y-2">
            <div className="bg-dot-grid flex h-24 items-end rounded-xl border bg-background p-3 text-sm">
              Canvas
            </div>
            <code className="block truncate font-mono text-xs text-muted-foreground">
              bg-background bg-dot-grid
            </code>
          </div>
          <div className="space-y-2">
            <div className="flex h-24 flex-col justify-end gap-2 rounded-xl border bg-card p-3 text-sm">
              <div className="rounded-lg bg-secondary px-3 py-2.5">Ligne en relief</div>
            </div>
            <code className="block truncate font-mono text-xs text-muted-foreground">
              rounded-lg bg-secondary
            </code>
          </div>
          <div className="space-y-2">
            <div className="flex h-24 items-end rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              Zone de danger
            </div>
            <code className="block truncate font-mono text-xs text-muted-foreground">
              border-destructive/30 bg-destructive/5
            </code>
          </div>
          <div className="space-y-2">
            <div className="flex h-24 items-end rounded-xl border border-success/25 bg-success/10 p-3 text-sm text-success">
              Fond teinté
            </div>
            <code className="block truncate font-mono text-xs text-muted-foreground">
              bg-success/10 border-success/25
            </code>
          </div>
          <div className="space-y-2">
            <div className="flex h-24 items-end rounded-xl border border-border-strong bg-popover p-3 text-sm shadow-xl shadow-black/40">
              Flottant
            </div>
            <code className="block truncate font-mono text-xs text-muted-foreground">
              bg-popover shadow-xl
            </code>
          </div>
        </div>
      </KitExample>
    </KitSection>
  );
}
