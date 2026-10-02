"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Cpu,
  Database,
  GitBranch,
  Globe,
  Hammer,
  Rocket,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";

import { EmptyState } from "@/components/shared/empty-state";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import { DatabaseSettingsPanel } from "@/features/databases";
import { DockerSourceSettings } from "@/features/docker";
import { ServiceDomains } from "@/features/domains";
import { GithubSourceSettings } from "@/features/github";
import { SPRING } from "@/lib/motion";
import type { Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DatabaseByService } from "./database-by-service";
import { BuildCard } from "./settings/build-card";
import { ServiceDangerZone } from "./settings/danger-zone";
import { DeployCard } from "./settings/deploy-card";
import { PortCard } from "./settings/port-card";
import { ResourcesCard } from "./settings/resources-card";
import { PostgresSourceSummary } from "./settings/source-summary";
import { VolumeCard } from "./settings/volume-card";

/** Attribute the panel scroller carries so the index can find it. */
export const PANEL_SCROLL_ATTRIBUTE = "data-panel-scroll";

interface SectionDef {
  id: string;
  title: string;
  icon: LucideIcon;
  /** Extra words the filter matches besides the title. */
  keywords: string[];
  content: ReactNode;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function sectionDomId(id: string): string {
  return `settings-section-${id}`;
}

function buildSections(service: Service, onDeleted: () => void): SectionDef[] {
  const { config, volume } = service;
  const type = service.source.type;
  const sections: SectionDef[] = [];

  sections.push({
    id: "source",
    title: "Source",
    icon: GitBranch,
    keywords: ["dépôt", "repository", "branche", "image", "tag", "version", "répertoire racine", "déploiement automatique"],
    content:
      type === "github" ? (
        <GithubSourceSettings serviceId={service.id} />
      ) : type === "docker" ? (
        <DockerSourceSettings serviceId={service.id} />
      ) : (
        <PostgresSourceSummary service={service} />
      ),
  });

  sections.push({
    id: "network",
    title: "Réseau",
    icon: Globe,
    keywords: ["domaine", "dns", "port", "ssl", "https", "adresse privée", "nginx"],
    content: (
      <div className="space-y-4">
        <ServiceDomains serviceId={service.id} />
        {type !== "postgres" ? (
          <PortCard key={`${service.id}:${config.port}`} service={service} />
        ) : null}
      </div>
    ),
  });

  if (type === "github") {
    sections.push({
      id: "build",
      title: "Build",
      icon: Hammer,
      keywords: ["nixpacks", "dockerfile", "commande de build", "compilation"],
      content: (
        <BuildCard
          key={`${service.id}:${config.builder}:${config.buildCommand}`}
          service={service}
        />
      ),
    });
  }

  if (type !== "postgres") {
    sections.push({
      id: "deploy",
      title: "Déploiement",
      icon: Rocket,
      keywords: ["commande de démarrage", "start", "healthcheck", "redémarrage", "restart", "réplicas", "instances"],
      content: (
        <DeployCard
          key={`${service.id}:${config.startCommand}:${config.healthcheckPath}:${config.restartPolicy}:${config.replicas}`}
          service={service}
        />
      ),
    });
  }

  sections.push({
    id: "resources",
    title: "Ressources",
    icon: Cpu,
    keywords: ["cpu", "vcpu", "processeur", "mémoire", "ram", "limite", ...(type !== "postgres" ? ["volume", "disque", "stockage", "montage"] : [])],
    content: (
      <div className="space-y-4">
        <ResourcesCard
          key={`${service.id}:${config.cpuLimit}:${config.memoryLimitMb}`}
          service={service}
        />
        {type !== "postgres" ? (
          <VolumeCard
            key={`${service.id}:${volume?.mountPath ?? "none"}:${volume?.sizeGb ?? 0}`}
            service={service}
          />
        ) : null}
      </div>
    ),
  });

  if (type === "postgres") {
    sections.push({
      id: "database",
      title: "Base de données",
      icon: Database,
      keywords: ["postgresql", "stockage", "connexions", "mot de passe", "réseau public", "identifiants", "supprimer"],
      content: (
        <DatabaseByService serviceId={service.id}>
          {(databaseId) => <DatabaseSettingsPanel databaseId={databaseId} onDeleted={onDeleted} />}
        </DatabaseByService>
      ),
    });
  } else {
    sections.push({
      id: "danger",
      title: "Zone de danger",
      icon: TriangleAlert,
      keywords: ["supprimer", "suppression", "delete"],
      content: <ServiceDangerZone service={service} onDeleted={onDeleted} />,
    });
  }

  return sections;
}

interface ServiceSettingsProps {
  service: Service;
  /** Called after the service was deleted from the danger zone. */
  onDeleted: () => void;
}

/** Settings tab: filterable sections down a rail, with a section index on wide panels. */
export function ServiceSettings({ service, onDeleted }: ServiceSettingsProps) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const sections = buildSections(service, onDeleted);
    const needle = normalize(query.trim());
    if (!needle) return sections;
    return sections.filter((section) =>
      normalize([section.title, ...section.keywords].join(" ")).includes(needle),
    );
  }, [service, onDeleted, query]);

  useEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>(`[${PANEL_SCROLL_ATTRIBUTE}]`);
    if (!root || !scroller) return;

    function onScroll() {
      if (!root || !scroller) return;
      const top = scroller.getBoundingClientRect().top;
      const elements = root.querySelectorAll<HTMLElement>("[data-settings-section]");
      let current: string | null = null;
      for (const element of elements) {
        if (element.getBoundingClientRect().top - top <= 96) {
          current = element.dataset.settingsSection ?? null;
        }
      }
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      if (atBottom && scroller.scrollTop > 0 && elements.length > 0) {
        current = elements[elements.length - 1].dataset.settingsSection ?? current;
      }
      setActiveId(current);
    }

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  const highlighted = visible.find((section) => section.id === activeId)?.id ?? visible[0]?.id;

  function scrollToSection(id: string) {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>(`[${PANEL_SCROLL_ATTRIBUTE}]`);
    const target = root?.querySelector<HTMLElement>(`#${sectionDomId(id)}`);
    if (!scroller || !target) return;
    const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({
      top: scroller.scrollTop + offset - 16,
      behavior: reduced ? "auto" : "smooth",
    });
    setActiveId(id);
  }

  return (
    <div ref={rootRef} className="@container space-y-6">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Filtrer les réglages…"
        shortcut="/"
        className="w-full max-w-sm sm:w-full"
      />

      {visible.length === 0 ? (
        <EmptyState
          compact
          icon={SearchX}
          title="Aucun réglage trouvé"
          description={`Aucune section ne correspond à « ${query.trim()} ».`}
          action={
            <Button variant="outline" size="sm" onClick={() => setQuery("")}>
              Effacer le filtre
            </Button>
          }
        />
      ) : (
        <div className="flex gap-10">
          <ol className="m-0 min-w-0 flex-1 list-none p-0">
            {visible.map((section, index) => {
              const Icon = section.icon;
              const last = index === visible.length - 1;
              return (
                <li
                  key={section.id}
                  id={sectionDomId(section.id)}
                  data-settings-section={section.id}
                  className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 @md:gap-x-4"
                >
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground transition-colors",
                        section.id === "danger" && "border-destructive/30 text-destructive",
                        section.id === highlighted && section.id !== "danger" && "border-brand-800 text-brand-400",
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    {last ? null : <span aria-hidden="true" className="mt-1 w-px flex-1 bg-border" />}
                  </div>
                  <div className={cn("min-w-0", last ? "pb-2" : "pb-8")}>
                    <h3 className="flex h-8 items-center text-base font-medium">{section.title}</h3>
                    <div className="mt-3">{section.content}</div>
                  </div>
                </li>
              );
            })}
          </ol>

          <nav aria-label="Sections des réglages" className="hidden w-40 shrink-0 @3xl:block">
            <ul className="sticky top-4 m-0 list-none space-y-0.5 border-l p-0">
              {visible.map((section) => {
                const active = section.id === highlighted;
                return (
                  <li key={section.id} className="relative">
                    {active ? (
                      <motion.span
                        layoutId="service-settings-index"
                        aria-hidden="true"
                        className="absolute inset-y-0 -left-px w-0.5 rounded-full bg-brand-400"
                        transition={SPRING.snappy}
                      />
                    ) : null}
                    <a
                      href={`#${sectionDomId(section.id)}`}
                      aria-current={active ? "location" : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        scrollToSection(section.id);
                      }}
                      className={cn(
                        "block rounded-r-md py-1.5 pr-2 pl-3 text-sm transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                        active ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {section.title}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      )}
    </div>
  );
}
