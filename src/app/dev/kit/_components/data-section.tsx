"use client";

import { useState } from "react";
import { Gauge, Rocket, Server, Shuffle, Timer } from "lucide-react";

import { AnimatedNumber } from "@/components/shared/animated-number";
import { ProgressBar } from "@/components/shared/progress-bar";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { RelativeTime } from "@/components/shared/relative-time";
import { ServiceIcon } from "@/components/shared/service-icon";
import { Sparkline } from "@/components/shared/sparkline";
import { StatCard } from "@/components/shared/stat-card";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { formatMegabytes, formatPercent } from "@/lib/format";
import { SERVICE_TYPE_LABELS } from "@/lib/status";
import type { ServiceType } from "@/lib/types";

import { KitExample, KitLabel, KitSection } from "./kit-section";
import { SAMPLE_PEOPLE, SAMPLE_PROJECTS, sampleSparkline } from "./sample-data";
import { useMountTime } from "./use-client-value";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const SERVICE_TYPES: ServiceType[] = ["github", "docker", "postgres"];

const RELATIVE_SAMPLES = [
  { label: "Il y a 20 secondes", offset: -20_000 },
  { label: "Il y a 3 minutes", offset: -3 * MINUTE },
  { label: "Il y a 2 heures", offset: -2 * HOUR },
  { label: "La veille", offset: -26 * HOUR },
  { label: "Il y a 5 jours", offset: -5 * DAY },
  { label: "Il y a 45 jours", offset: -45 * DAY },
  { label: "Dans 3 jours", offset: 3 * DAY + HOUR },
];

const SPARKLINES = {
  services: sampleSparkline(11, 16, 0.4),
  deployments: sampleSparkline(23, 16, 0.9),
  duration: sampleSparkline(37, 16, -0.8),
};

interface DataSectionProps {
  loading: boolean;
}

export function DataSection({ loading }: DataSectionProps) {
  const mountTime = useMountTime();
  const [metrics, setMetrics] = useState({ requests: 12840, memory: 412, success: 97.4 });

  function shuffle() {
    setMetrics({
      requests: Math.round(8000 + Math.random() * 9000),
      memory: Math.round(180 + Math.random() * 800),
      success: Math.round((90 + Math.random() * 10) * 10) / 10,
    });
  }

  return (
    <KitSection
      id="donnees"
      title="Données"
      description={"Indicateurs, identité visuelle des projets et des services, temps relatif et progression. Activez «\u00a0États de chargement\u00a0» en haut de page pour vérifier qu’aucune carte ne change de taille."}
    >
      <KitExample title="Cartes d’indicateur" code="<StatCard />">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Services en ligne"
            value={12}
            hint="sur 14 services"
            icon={Server}
            tone="success"
            sparkline={SPARKLINES.services}
            loading={loading}
          />
          <StatCard
            label="Déploiements (24 h)"
            value={38}
            icon={Rocket}
            tone="brand"
            trend={{ value: 18, label: "vs hier" }}
            sparkline={SPARKLINES.deployments}
            loading={loading}
            href="/dev/kit?section=donnees"
          />
          <StatCard
            label="Durée moyenne de build"
            value="1 min 42 s"
            icon={Timer}
            tone="info"
            trend={{ value: -12.5, label: "sur 7 j", invert: true }}
            sparkline={SPARKLINES.duration}
            loading={loading}
          />
          <StatCard
            label="Taux de réussite"
            value={97.4}
            format={(value) => formatPercent(value, 1)}
            hint="2 échecs cette semaine"
            icon={Gauge}
            tone="warning"
            trend={{ value: -1.2 }}
            loading={loading}
          />
        </div>
      </KitExample>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KitExample title="Nombre animé" code="<AnimatedNumber />" bodyClassName="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Requêtes / min</p>
              <p className="text-2xl font-semibold">
                <AnimatedNumber value={metrics.requests} />
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Mémoire</p>
              <p className="text-2xl font-semibold">
                <AnimatedNumber value={metrics.memory} format={formatMegabytes} />
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Réussite</p>
              <p className="text-2xl font-semibold">
                <AnimatedNumber
                  value={metrics.success}
                  format={(value) => formatPercent(value, 1)}
                />
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={shuffle}>
            <Shuffle data-icon="inline-start" />
            Nouvelles valeurs
          </Button>
        </KitExample>

        <KitExample title="Progression" code="<ProgressBar />" bodyClassName="space-y-4">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Déploiement</span>
                <span className="tabular">64 %</span>
              </div>
              <ProgressBar value={64} tone="info" label="Progression du déploiement" />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Processeur</span>
                <span className="tabular">35 %</span>
              </div>
              <ProgressBar value={35} tone="success" label="Utilisation du processeur" />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Mémoire</span>
                <span className="tabular">420 Mo / 512 Mo</span>
              </div>
              <ProgressBar value={82} tone="warning" label="Utilisation de la mémoire" />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Volume</span>
                <span className="tabular">4,8 Go / 5 Go</span>
              </div>
              <ProgressBar value={96} tone="danger" label="Utilisation du volume" />
            </div>
          </div>
          <div className="space-y-2">
            <KitLabel>Durée inconnue, et les trois épaisseurs</KitLabel>
            <ProgressBar indeterminate label="Clonage du dépôt" />
            <div className="grid grid-cols-3 items-center gap-3">
              <ProgressBar value={45} size="sm" />
              <ProgressBar value={45} size="md" />
              <ProgressBar value={45} size="lg" />
            </div>
          </div>
        </KitExample>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KitExample title="Icônes de service" code="<ServiceIcon />" bodyClassName="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {SERVICE_TYPES.map((type) => (
              <div key={type} className="flex items-center gap-3">
                <ServiceIcon type={type} tile="lg" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{SERVICE_TYPE_LABELS[type]}</p>
                  <p className="font-mono text-xs text-muted-foreground">{type}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <KitLabel>Sans tuile, puis tuiles sm, md et lg</KitLabel>
            <div className="flex flex-wrap items-center gap-4">
              {SERVICE_TYPES.map((type) => (
                <div key={type} className="flex items-center gap-2">
                  <ServiceIcon type={type} />
                  <ServiceIcon type={type} tile="sm" />
                  <ServiceIcon type={type} tile />
                  <ServiceIcon type={type} tile="lg" />
                </div>
              ))}
            </div>
          </div>
        </KitExample>

        <KitExample title="Avatars" code="<ProjectAvatar /> · <UserAvatar />" bodyClassName="space-y-4">
          <div className="space-y-2">
            <KitLabel>Projets : initiales sur la couleur d’accent</KitLabel>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
              {SAMPLE_PROJECTS.map((project) => (
                <div key={project.name} className="flex min-w-0 items-center gap-2.5">
                  <ProjectAvatar name={project.name} color={project.color} />
                  <span className="truncate text-sm">{project.name}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <ProjectAvatar name="CanCham Connect" color="purple" size="xs" />
              <ProjectAvatar name="CanCham Connect" color="purple" size="sm" />
              <ProjectAvatar name="CanCham Connect" color="purple" size="md" />
              <ProjectAvatar name="CanCham Connect" color="purple" size="lg" />
            </div>
          </div>
          <div className="space-y-2">
            <KitLabel>Personnes : teinte stable dérivée du nom</KitLabel>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {SAMPLE_PEOPLE.map((name) => (
                <span key={name} className="inline-flex items-center gap-2 text-sm">
                  <UserAvatar name={name} />
                  {name}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <UserAvatar name="Marco Razafy" size="sm" />
              <UserAvatar name="Marco Razafy" size="md" />
              <UserAvatar name="Marco Razafy" size="lg" />
            </div>
          </div>
        </KitExample>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KitExample title="Temps relatif" code="<RelativeTime />" bodyClassName="p-0 sm:p-0">
          <ul className="divide-y text-sm">
            {RELATIVE_SAMPLES.map((sample) => (
              <li key={sample.label} className="flex items-center justify-between gap-4 px-4 py-2 sm:px-5">
                <span className="text-muted-foreground">{sample.label}</span>
                <RelativeTime
                  date={mountTime === 0 ? null : mountTime + sample.offset}
                  className="tabular"
                />
              </li>
            ))}
            <li className="flex items-center justify-between gap-4 px-4 py-2 sm:px-5">
              <span className="text-muted-foreground">Avec un préfixe</span>
              <RelativeTime
                date={mountTime === 0 ? null : mountTime - 12 * MINUTE}
                prefix="Déployé"
              />
            </li>
          </ul>
        </KitExample>

        <KitExample title="Sparkline" code="<Sparkline />" bodyClassName="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Sparkline data={SPARKLINES.deployments} />
              <p className="font-mono text-xs text-muted-foreground">brand</p>
            </div>
            <div className="space-y-1">
              <Sparkline data={SPARKLINES.services} tone="success" />
              <p className="font-mono text-xs text-muted-foreground">success</p>
            </div>
            <div className="space-y-1">
              <Sparkline data={SPARKLINES.duration} tone="info" />
              <p className="font-mono text-xs text-muted-foreground">info</p>
            </div>
            <div className="space-y-1">
              <Sparkline data={SPARKLINES.services} tone="warning" />
              <p className="font-mono text-xs text-muted-foreground">warning</p>
            </div>
            <div className="space-y-1">
              <Sparkline data={SPARKLINES.duration} tone="danger" />
              <p className="font-mono text-xs text-muted-foreground">danger</p>
            </div>
            <div className="space-y-1">
              <Sparkline data={[4, 4, 4, 4, 4]} tone="neutral" />
              <p className="font-mono text-xs text-muted-foreground">neutral (série plate)</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">Dans une ligne :</span>
            <span className="font-medium">cancham-web</span>
            <Sparkline
              data={SPARKLINES.deployments}
              className="ml-auto h-6 w-28"
              label="Trafic en hausse sur les 16 dernières heures"
            />
          </div>
        </KitExample>
      </div>
    </KitSection>
  );
}
