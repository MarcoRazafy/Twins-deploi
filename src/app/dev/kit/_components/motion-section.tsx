"use client";

import { useState } from "react";
import { PanelRight, Play, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { FadeIn, Stagger, StaggerItem } from "@/components/shared/motion";
import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusDot } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { DURATION, EASE, hoverLift, scaleIn, slideInRight, SPRING } from "@/lib/motion";
import type { ServiceType } from "@/lib/types";
import { cn } from "@/lib/utils";

import { KitExample, KitSection } from "./kit-section";

const TOKENS = [
  { name: "DURATION.fast", value: formatDuration(DURATION.fast * 1000), usage: "Survol, pression, sorties" },
  { name: "DURATION.base", value: formatDuration(DURATION.base * 1000), usage: "Entrées, changements d’état" },
  { name: "DURATION.slow", value: formatDuration(DURATION.slow * 1000), usage: "Panneaux, transitions de page" },
  { name: "EASE.out", value: `[${EASE.out.join(", ")}]`, usage: "Toutes les entrées" },
  { name: "EASE.inOut", value: `[${EASE.inOut.join(", ")}]`, usage: "Déplacements" },
  { name: "SPRING.snappy", value: `raideur ${SPRING.snappy.stiffness}`, usage: "Indicateurs partagés, glisser-déposer" },
  { name: "SPRING.smooth", value: `raideur ${SPRING.smooth.stiffness}`, usage: "Panneaux, cartes, zoom" },
];

const SERVICES: Array<{ name: string; type: ServiceType; detail: string }> = [
  { name: "cancham-web", type: "github", detail: "cancham.mg" },
  { name: "api-gateway", type: "docker", detail: "nginx:1.27-alpine" },
  { name: "Postgres", type: "postgres", detail: "postgres:17" },
  { name: "worker-emails", type: "github", detail: "cancham-mg/worker" },
  { name: "redis-cache", type: "docker", detail: "redis:7" },
  { name: "metabase", type: "docker", detail: "metabase/metabase" },
];

export function MotionSection() {
  const [replay, setReplay] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState("cancham-web");

  return (
    <KitSection
      id="mouvement"
      title="Mouvement"
      description={"Chaque animation exprime une cause et son effet, dure moins de 400\u00a0ms et n’anime que transform et opacity. Avec «\u00a0réduire les animations\u00a0», les déplacements sont supprimés et l’information reste complète."}
    >
      <KitExample title="Jetons" code="src/lib/motion.ts" bodyClassName="p-0 sm:p-0">
        <ul className="divide-y text-sm">
          {TOKENS.map((token) => (
            <li
              key={token.name}
              className="grid grid-cols-1 gap-x-6 gap-y-0.5 px-4 py-2.5 sm:px-5 md:grid-cols-[12rem_14rem_1fr] md:items-center"
            >
              <code className="font-mono text-xs">{token.name}</code>
              <span className="tabular text-xs text-muted-foreground">{token.value}</span>
              <span className="text-muted-foreground">{token.usage}</span>
            </li>
          ))}
        </ul>
      </KitExample>

      <KitExample title="Entrée en cascade" code="<Stagger> · <StaggerItem>" bodyClassName="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            40 ms entre deux éléments, délai plafonné après 12. Les cartes se soulèvent au survol.
          </p>
          <Button variant="outline" size="sm" onClick={() => setReplay((count) => count + 1)}>
            <Play data-icon="inline-start" />
            Rejouer
          </Button>
        </div>
        <Stagger key={replay} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((service) => (
            <StaggerItem key={service.name}>
              <motion.button
                type="button"
                {...hoverLift}
                aria-pressed={selected === service.name}
                onClick={() => setSelected(service.name)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  selected === service.name
                    ? "ring-brand-glow"
                    : "transition-colors hover:border-border-strong hover:bg-secondary/40",
                )}
              >
                <ServiceIcon type={service.type} tile />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{service.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {service.detail}
                  </span>
                </span>
                <StatusDot tone="success" />
              </motion.button>
            </StaggerItem>
          ))}
        </Stagger>
      </KitExample>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KitExample title="Panneau latéral" code="slideInRight" bodyClassName="space-y-3">
          <Button variant="outline" size="sm" onClick={() => setPanelOpen((open) => !open)}>
            <PanelRight data-icon="inline-start" />
            {panelOpen ? "Fermer le panneau" : "Ouvrir le panneau"}
          </Button>
          <div className="bg-dot-grid relative h-44 overflow-hidden rounded-xl border bg-background">
            <AnimatePresence>
              {panelOpen ? (
                <motion.aside
                  variants={slideInRight}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="absolute inset-y-0 right-0 flex w-3/5 flex-col gap-2 border-l bg-card p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-sm font-medium">
                      <ServiceIcon type="postgres" />
                      Postgres
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Fermer le panneau"
                      onClick={() => setPanelOpen(false)}
                    >
                      <X />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Glisse depuis la droite sur 24 px avec un fondu ; la sortie est plus rapide que
                    l’entrée.
                  </p>
                </motion.aside>
              ) : null}
            </AnimatePresence>
          </div>
        </KitExample>

        <KitExample title="Fondu et échelle" code="<FadeIn /> · scaleIn" bodyClassName="space-y-3">
          <div key={replay} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FadeIn className="rounded-lg bg-secondary px-3 py-2.5 text-sm">FadeIn</FadeIn>
            <FadeIn delay={0.12} className="rounded-lg bg-secondary px-3 py-2.5 text-sm">
              delay 0,12 s
            </FadeIn>
            <motion.div
              variants={scaleIn}
              initial="hidden"
              animate="visible"
              className="rounded-lg bg-secondary px-3 py-2.5 text-sm"
            >
              scaleIn
            </motion.div>
          </div>
          <p className="text-xs text-muted-foreground">
            Le bouton Rejouer, plus haut, relance aussi ces entrées. Les dialogues, menus et
            infobulles gardent les animations CSS de shadcn.
          </p>
        </KitExample>
      </div>
    </KitSection>
  );
}
