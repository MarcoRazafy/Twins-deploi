"use client";

import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CornerDownLeft, RotateCcw } from "lucide-react";

import { isNavItemVisible, NAV_ITEMS, QUICK_CREATE_ACTIONS } from "@/components/layout/nav-config";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusDot } from "@/components/shared/status-badge";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useHotkey } from "@/hooks/use-hotkey";
import { API_MODE } from "@/lib/api";
import { pluralize } from "@/lib/format";
import { useProjects, useSession } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { SERVICE_STATUS, SERVICE_TYPE_LABELS } from "@/lib/status";
import { useUiStore } from "@/stores/ui-store";

/**
 * Item values read "label|id": the label is what gets searched, the id only
 * keeps every value unique (cmdk tracks the highlighted item by value).
 */
const VALUE_SEPARATOR = "|";
const WORD_BREAK = /[\s\-_/.]+/;

/** "Déploiements" → "deploiements": typing without accents still finds the label. */
function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** In order but not necessarily adjacent: "pgsql" finds "postgresql". */
function isSubsequence(query: string, text: string): boolean {
  let from = 0;
  for (const character of query) {
    const index = text.indexOf(character, from);
    if (index === -1) return false;
    from = index + 1;
  }
  return true;
}

/** How well one typed word matches an item, from 0 (not at all) to 1 (label starts with it). */
function scoreWord(word: string, label: string, keywords: string[]): number {
  if (label.startsWith(word)) return 1;
  if (label.split(WORD_BREAK).some((part) => part.startsWith(word))) return 0.9;
  if (label.includes(word)) return 0.8;
  if (keywords.some((keyword) => keyword.includes(word))) return 0.6;
  if (word.length >= 3 && isSubsequence(word, label)) return 0.3;
  return 0;
}

/**
 * Own ranking instead of cmdk's default scorer, which lets long keyword lists
 * (and ids) dilute an exact label match, and ignores accents. Every typed word
 * has to match; the label counts more than synonyms and the project name.
 */
function filterItem(value: string, search: string, keywords: string[] = []): number {
  const words = stripAccents(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;

  const label = stripAccents(value.split(VALUE_SEPARATOR)[0] ?? "");
  const synonyms = keywords.map(stripAccents);
  let total = 0;
  for (const word of words) {
    const score = scoreWord(word, label, synonyms);
    if (score === 0) return 0;
    total += score;
  }
  return total / words.length;
}

function PaletteHint({ keys, label }: { keys: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys}
      {label}
    </span>
  );
}

/** Global search and actions, opened with mod+K or from the top bar. */
export function CommandPalette({ onResetDemo }: { onResetDemo: () => void }) {
  const router = useRouter();
  const open = useUiStore((state) => state.commandOpen);
  const setOpen = useUiStore((state) => state.setCommandOpen);
  const { data: projects } = useProjects();
  const role = useSession().data?.user?.role ?? null;

  useHotkey(
    "mod+k",
    () => {
      const { commandOpen, setCommandOpen } = useUiStore.getState();
      setCommandOpen(!commandOpen);
    },
    { allowInInputs: true },
  );

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Palette de commandes"
      description="Rechercher une page, un projet, un service ou une action."
      className="sm:max-w-xl"
    >
      <Command loop filter={filterItem}>
        <CommandInput placeholder="Rechercher une page, un projet, un service…" />
        <CommandList className="max-h-80">
          <CommandEmpty>Aucun résultat.</CommandEmpty>

          <CommandGroup heading="Navigation">
            {NAV_ITEMS.filter((item) => isNavItemVisible(item, role)).map(({ id, label, href, icon: Icon, keywords }) => (
              <CommandItem
                key={id}
                value={`${label}${VALUE_SEPARATOR}${href}`}
                keywords={keywords}
                onSelect={() => go(href)}
              >
                <Icon className="text-muted-foreground" />
                <span className="truncate">{label}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          {projects && projects.length > 0 ? (
            <CommandGroup heading="Projets">
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`${project.name}${VALUE_SEPARATOR}${project.id}`}
                  keywords={["projet", "project", "workspace"]}
                  onSelect={() => go(routes.workspace(project.id))}
                >
                  <ProjectAvatar name={project.name} color={project.color} size="xs" />
                  <span className="truncate">{project.name}</span>
                  <CommandShortcut className="tracking-normal">
                    {pluralize(project.stats.services, "service")}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {projects && projects.some((project) => project.services.length > 0) ? (
            <CommandGroup heading="Services">
              {projects.flatMap((project) =>
                project.services.map((service) => {
                  const status = SERVICE_STATUS[service.status];
                  return (
                    <CommandItem
                      key={service.id}
                      value={`${service.name}${VALUE_SEPARATOR}${service.id}`}
                      keywords={[project.name, SERVICE_TYPE_LABELS[service.type], "service"]}
                      onSelect={() => go(routes.workspace(project.id, { service: service.id }))}
                    >
                      <ServiceIcon type={service.type} />
                      <span className="truncate">{service.name}</span>
                      <CommandShortcut className="flex min-w-0 items-center gap-2 tracking-normal">
                        <span className="truncate">{project.name}</span>
                        <StatusDot tone={status.tone} pulse={status.pulse} label={status.label} />
                      </CommandShortcut>
                    </CommandItem>
                  );
                }),
              )}
            </CommandGroup>
          ) : null}

          <CommandGroup heading="Actions">
            {QUICK_CREATE_ACTIONS.map(({ id, label, href, icon: Icon, keywords }) => (
              <CommandItem
                key={id}
                value={`${label}${VALUE_SEPARATOR}${id}`}
                keywords={keywords}
                onSelect={() => go(href)}
              >
                <Icon className="text-muted-foreground" />
                <span className="truncate">{label}</span>
              </CommandItem>
            ))}
            {API_MODE === "mock" ? (
              <CommandItem
                value={`Réinitialiser la démo${VALUE_SEPARATOR}reset-demo`}
                keywords={["reset", "données", "effacer", "restaurer"]}
                onSelect={() => {
                  setOpen(false);
                  onResetDemo();
                }}
              >
                <RotateCcw className="text-muted-foreground" />
                <span className="truncate">Réinitialiser la démo</span>
              </CommandItem>
            ) : null}
          </CommandGroup>
        </CommandList>

        <div className="hidden items-center gap-4 border-t border-border px-3 py-2 text-xs text-muted-foreground sm:flex">
          <PaletteHint
            keys={
              <>
                <Kbd>
                  <ArrowUp />
                </Kbd>
                <Kbd>
                  <ArrowDown />
                </Kbd>
              </>
            }
            label="Naviguer"
          />
          <PaletteHint
            keys={
              <Kbd>
                <CornerDownLeft />
              </Kbd>
            }
            label="Ouvrir"
          />
          <span className="ml-auto">
            <PaletteHint keys={<Kbd>Échap</Kbd>} label="Fermer" />
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}
