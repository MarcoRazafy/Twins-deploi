"use client";

import { StatusBadge, StatusDot } from "@/components/shared/status-badge";
import {
  STATUS_MAPS,
  TONE_CLASSES,
  type StatusKind,
  type StatusOf,
  type StatusTone,
} from "@/lib/status";
import { cn } from "@/lib/utils";

import { KitExample, KitLabel, KitSection } from "./kit-section";

const KINDS: Array<{ kind: StatusKind; title: string; type: string }> = [
  { kind: "service", title: "Service", type: "ServiceStatus" },
  { kind: "deployment", title: "Déploiement", type: "DeploymentStatus" },
  { kind: "container", title: "Conteneur", type: "ContainerState" },
  { kind: "health", title: "Santé du conteneur", type: "ContainerHealth" },
  { kind: "domain", title: "Domaine", type: "DomainStatus" },
  { kind: "ssl", title: "Certificat SSL", type: "SslStatus" },
  { kind: "backup", title: "Sauvegarde", type: "BackupStatus" },
];

const TONES: Array<{ tone: StatusTone; meaning: string }> = [
  { tone: "success", meaning: "En ligne, actif, valide" },
  { tone: "info", meaning: "En cours (pulsation)" },
  { tone: "warning", meaning: "En attente, attention requise" },
  { tone: "danger", meaning: "Échec, crash" },
  { tone: "neutral", meaning: "Arrêté, annulé, remplacé" },
];

/** Every `{ kind, status }` pair of a kind, typed for `<StatusBadge>`. */
function pairsOf(kind: StatusKind): StatusOf[] {
  return Object.keys(STATUS_MAPS[kind]).map((status) => ({ kind, status }) as StatusOf);
}

export function StatusSection() {
  return (
    <KitSection
      id="statuts"
      title="Statuts"
      description="Tous les statuts passent par StatusBadge et StatusDot, alimentés par lib/status.ts. La couleur n’est jamais le seul signal : un libellé l’accompagne toujours."
    >
      <KitExample title="Tons" code="StatusTone · TONE_CLASSES">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {TONES.map(({ tone, meaning }) => (
            <div
              key={tone}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                TONE_CLASSES[tone].bg,
                TONE_CLASSES[tone].border,
              )}
            >
              <StatusDot tone={tone} pulse={tone === "info"} />
              <div className="min-w-0">
                <p className={cn("font-mono text-xs", TONE_CLASSES[tone].text)}>{tone}</p>
                <p className="truncate text-xs text-muted-foreground">{meaning}</p>
              </div>
            </div>
          ))}
        </div>
      </KitExample>

      <KitExample
        title="Badges par famille"
        code={'<StatusBadge kind="…" status="…" />'}
        bodyClassName="divide-y p-0 sm:p-0"
      >
        {KINDS.map(({ kind, title, type }) => (
          <div
            key={kind}
            className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 sm:px-5 md:grid-cols-[11rem_1fr] md:items-center"
          >
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {kind} · {type}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {pairsOf(kind).map((pair) => (
                <StatusBadge key={pair.status} {...pair} />
              ))}
              {kind === "container" ? (
                <StatusBadge kind="container" status="exited" exitCode={137} />
              ) : null}
            </div>
          </div>
        ))}
      </KitExample>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KitExample title="Tailles et icônes" code="size · showIcon" bodyClassName="space-y-4">
          <div className="space-y-2">
            <KitLabel>Avec icône (taille md)</KitLabel>
            <div className="flex flex-wrap gap-2">
              {pairsOf("deployment").map((pair) => (
                <StatusBadge key={pair.status} {...pair} showIcon />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <KitLabel>Compact (taille sm), pour les lignes denses</KitLabel>
            <div className="flex flex-wrap gap-2">
              {pairsOf("service").map((pair) => (
                <StatusBadge key={pair.status} {...pair} size="sm" />
              ))}
            </div>
          </div>
        </KitExample>

        <KitExample title="Point de statut" code="<StatusDot />" bodyClassName="space-y-4">
          <div className="space-y-2">
            <KitLabel>Sur une carte de service</KitLabel>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span className="inline-flex items-center gap-2">
                <StatusDot tone="success" />
                En ligne
              </span>
              <span className="inline-flex items-center gap-2">
                <StatusDot tone="info" pulse />
                Déploiement en cours
              </span>
              <span className="inline-flex items-center gap-2">
                <StatusDot tone="danger" />
                En erreur
              </span>
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <StatusDot tone="neutral" />
                Arrêté
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <KitLabel>Seul, avec un nom accessible (prop label)</KitLabel>
            <div className="flex items-center gap-4">
              <StatusDot tone="success" label="En ligne" />
              <StatusDot tone="info" pulse label="Build en cours" />
              <StatusDot tone="warning" label="DNS en attente" />
              <StatusDot tone="danger" label="En erreur" />
              <StatusDot tone="neutral" label="Arrêté" />
            </div>
          </div>
        </KitExample>
      </div>
    </KitSection>
  );
}
