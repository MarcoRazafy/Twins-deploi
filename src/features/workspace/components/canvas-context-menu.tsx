"use client";

import {
  Copy,
  Database,
  ExternalLink,
  Grid3x3,
  KeyRound,
  Link2,
  Maximize,
  Play,
  Plus,
  RotateCw,
  Rocket,
  ScrollText,
  Search,
  Settings,
  Square,
  Trash2,
  Workflow,
  ZoomIn,
} from "lucide-react";

import { ServiceIcon } from "@/components/shared/service-icon";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { isServiceBusy } from "@/lib/status";
import type { Position, Service, ServiceType } from "@/lib/types";
import type { ServiceAction } from "@/lib/queries";

export type MenuTarget =
  | { kind: "canvas"; world: Position }
  | { kind: "service"; id: string };

export interface CanvasMenuProps {
  target: MenuTarget;
  services: readonly Service[];
  /** "fromId>toId" of every existing connection (either direction blocks a new one). */
  connectedPairs: ReadonlySet<string>;
  showGrid: boolean;
  onOpenService: (id: string, tab?: string) => void;
  onRedeploy: (service: Service) => void;
  onServiceAction: (service: Service, action: ServiceAction) => void;
  onCopyUrl: (service: Service) => void;
  onConnect: (fromId: string, toId: string) => void;
  onDelete: (service: Service) => void;
  onAddFlow: (kind: ServiceType, world: Position) => void;
  onFit: () => void;
  onResetZoom: () => void;
  onArrange: () => void;
  onToggleGrid: () => void;
}

const ADD_ITEMS: ReadonlyArray<{ kind: ServiceType; label: string }> = [
  { kind: "github", label: "Dépôt GitHub" },
  { kind: "docker", label: "Image Docker" },
  { kind: "postgres", label: "Base PostgreSQL" },
];

/** Tabs offered as shortcuts: databases have their own panel tabs. */
function tabShortcuts(service: Service) {
  if (service.source.type === "postgres") {
    return [
      { tab: "data", label: "Données", icon: Database },
      { tab: "connect", label: "Connexion", icon: Link2 },
      { tab: "backups", label: "Sauvegardes", icon: Rocket },
      { tab: "settings", label: "Réglages", icon: Settings },
    ];
  }
  return [
    { tab: "deployments", label: "Déploiements", icon: Rocket },
    { tab: "variables", label: "Variables", icon: KeyRound },
    { tab: "logs", label: "Logs", icon: ScrollText },
    { tab: "settings", label: "Réglages", icon: Settings },
  ];
}

/** Body of the single context menu: the canvas menu or the card menu. */
export function CanvasMenuBody(props: CanvasMenuProps) {
  const { target, services } = props;
  if (target.kind === "service") {
    const service = services.find((candidate) => candidate.id === target.id);
    return service ? <ServiceMenu {...props} service={service} /> : <CanvasMenu {...props} />;
  }
  return <CanvasMenu {...props} world={target.world} />;
}

function CanvasMenu({
  world,
  showGrid,
  onAddFlow,
  onFit,
  onResetZoom,
  onArrange,
  onToggleGrid,
  services,
}: CanvasMenuProps & { world?: Position }) {
  const at = world ?? { x: 0, y: 0 };
  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Plus />
          Ajouter un service
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {ADD_ITEMS.map((item) => (
            <ContextMenuItem key={item.kind} onSelect={() => onAddFlow(item.kind, at)}>
              <ServiceIcon type={item.kind} className="size-4" />
              {item.label}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onFit}>
        <Maximize />
        Ajuster à l’écran
      </ContextMenuItem>
      <ContextMenuItem onSelect={onResetZoom}>
        <ZoomIn />
        Réinitialiser le zoom
      </ContextMenuItem>
      <ContextMenuItem onSelect={onArrange} disabled={services.length < 2}>
        <Workflow />
        Organiser automatiquement
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onToggleGrid}>
        <Grid3x3 />
        {showGrid ? "Masquer la grille" : "Afficher la grille"}
      </ContextMenuItem>
    </>
  );
}

function ServiceMenu({
  service,
  services,
  connectedPairs,
  onOpenService,
  onRedeploy,
  onServiceAction,
  onCopyUrl,
  onConnect,
  onDelete,
}: CanvasMenuProps & { service: Service }) {
  const busy = isServiceBusy(service.status);
  const others = services.filter((candidate) => candidate.id !== service.id);
  const isDatabase = service.source.type === "postgres";

  return (
    <>
      <ContextMenuLabel className="max-w-56 truncate">{service.name}</ContextMenuLabel>
      <ContextMenuItem onSelect={() => onOpenService(service.id)}>
        <Search />
        Ouvrir
      </ContextMenuItem>
      {tabShortcuts(service).map((shortcut) => (
        <ContextMenuItem
          key={shortcut.tab}
          onSelect={() => onOpenService(service.id, shortcut.tab)}
        >
          <shortcut.icon />
          {shortcut.label}
        </ContextMenuItem>
      ))}
      <ContextMenuSeparator />
      {!isDatabase ? (
        <ContextMenuItem disabled={busy} onSelect={() => onRedeploy(service)}>
          <Rocket />
          Redéployer
        </ContextMenuItem>
      ) : null}
      {service.status === "stopped" ? (
        <ContextMenuItem disabled={busy} onSelect={() => onServiceAction(service, "start")}>
          <Play />
          Démarrer
        </ContextMenuItem>
      ) : (
        <>
          <ContextMenuItem disabled={busy} onSelect={() => onServiceAction(service, "restart")}>
            <RotateCw />
            Redémarrer
          </ContextMenuItem>
          <ContextMenuItem disabled={busy} onSelect={() => onServiceAction(service, "stop")}>
            <Square />
            Arrêter
          </ContextMenuItem>
        </>
      )}
      {service.primaryDomain ? (
        <ContextMenuItem onSelect={() => onCopyUrl(service)}>
          <Copy />
          Copier l’URL publique
        </ContextMenuItem>
      ) : null}
      {service.primaryDomain ? (
        <ContextMenuItem
          onSelect={() => window.open(`https://${service.primaryDomain}`, "_blank", "noopener")}
        >
          <ExternalLink />
          Ouvrir le site
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={others.length === 0}>
          <Link2 />
          Connecter à…
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {others.map((other) => {
            const connected =
              connectedPairs.has(`${service.id}>${other.id}`) ||
              connectedPairs.has(`${other.id}>${service.id}`);
            return (
              <ContextMenuItem
                key={other.id}
                disabled={connected}
                onSelect={() => onConnect(service.id, other.id)}
              >
                <ServiceIcon type={other.source.type} className="size-4" />
                <span className="truncate">{other.name}</span>
              </ContextMenuItem>
            );
          })}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => onDelete(service)}>
        <Trash2 />
        Supprimer
      </ContextMenuItem>
    </>
  );
}
