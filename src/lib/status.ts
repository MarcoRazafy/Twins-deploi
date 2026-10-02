/**
 * Status metadata: one map per status enum of the domain model, giving each
 * value its French label, its tone (colour family) and its icon.
 *
 * UI code never picks a status colour by hand: it renders `<StatusBadge>` /
 * `<StatusDot>` (which read these maps) or uses `TONE_CLASSES`.
 */

import {
  Activity,
  Archive,
  Ban,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleStop,
  CircleX,
  Clock,
  Globe,
  Hammer,
  HeartCrack,
  HeartPulse,
  Info,
  Minus,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  ShieldEllipsis,
  ShieldOff,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import type {
  ActivitySeverity,
  BackupStatus,
  ContainerHealth,
  ContainerState,
  DeploymentStatus,
  DeploymentTrigger,
  DomainStatus,
  LogLevel,
  LogStream,
  ServiceStatus,
  ServiceType,
  SslStatus,
} from "@/lib/types";

export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";

export interface StatusMeta {
  /** French label shown next to the dot or icon. */
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
  /** In-progress statuses pulse (the only infinite animation a status gets). */
  pulse?: boolean;
}

/**
 * Class strings per tone, written in full so Tailwind can see them.
 * Tinted surface recipe: `bg` + `text` + `border` (see DESIGN.md §2).
 */
export const TONE_CLASSES: Record<
  StatusTone,
  { text: string; bg: string; border: string; dot: string }
> = {
  success: {
    text: "text-success",
    bg: "bg-success/10",
    border: "border-success/25",
    dot: "bg-success",
  },
  info: {
    text: "text-info",
    bg: "bg-info/10",
    border: "border-info/25",
    dot: "bg-info",
  },
  warning: {
    text: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/25",
    dot: "bg-warning",
  },
  danger: {
    text: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/30",
    dot: "bg-destructive",
  },
  neutral: {
    text: "text-muted-foreground",
    bg: "bg-secondary",
    border: "border-border-strong",
    dot: "bg-muted-foreground",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Status maps
// ─────────────────────────────────────────────────────────────────────────────

export const SERVICE_STATUS: Record<ServiceStatus, StatusMeta> = {
  online: { label: "En ligne", tone: "success", icon: CircleCheck },
  building: { label: "Build en cours", tone: "info", icon: Hammer, pulse: true },
  deploying: {
    label: "Déploiement en cours",
    tone: "info",
    icon: Rocket,
    pulse: true,
  },
  restarting: { label: "Redémarrage", tone: "info", icon: RotateCw, pulse: true },
  crashed: { label: "En erreur", tone: "danger", icon: TriangleAlert },
  stopped: { label: "Arrêté", tone: "neutral", icon: CircleStop },
};

export const DEPLOYMENT_STATUS: Record<DeploymentStatus, StatusMeta> = {
  queued: { label: "En file d’attente", tone: "info", icon: Clock, pulse: true },
  building: { label: "Build en cours", tone: "info", icon: Hammer, pulse: true },
  deploying: {
    label: "Déploiement en cours",
    tone: "info",
    icon: Rocket,
    pulse: true,
  },
  active: { label: "Actif", tone: "success", icon: CircleCheck },
  failed: { label: "Échec", tone: "danger", icon: CircleX },
  crashed: { label: "En erreur", tone: "danger", icon: TriangleAlert },
  cancelled: { label: "Annulé", tone: "neutral", icon: Ban },
  // Superseded by a newer deployment; still a valid rollback target.
  removed: { label: "Remplacé", tone: "neutral", icon: Archive },
};

/**
 * `exited` is neutral here (clean stop). A non-zero exit code is a failure:
 * resolve it with `getContainerStateMeta(state, exitCode)`.
 */
export const CONTAINER_STATE: Record<ContainerState, StatusMeta> = {
  running: { label: "En exécution", tone: "success", icon: Play },
  restarting: { label: "Redémarrage", tone: "info", icon: RotateCw, pulse: true },
  paused: { label: "En pause", tone: "warning", icon: Pause },
  exited: { label: "Arrêté", tone: "neutral", icon: CircleStop },
  created: { label: "Créé", tone: "neutral", icon: CircleDashed },
};

export const CONTAINER_HEALTH: Record<ContainerHealth, StatusMeta> = {
  healthy: { label: "Sain", tone: "success", icon: HeartPulse },
  unhealthy: { label: "Défaillant", tone: "danger", icon: HeartCrack },
  starting: { label: "Démarrage", tone: "info", icon: Activity, pulse: true },
  none: { label: "Sans healthcheck", tone: "neutral", icon: Minus },
};

export const DOMAIN_STATUS: Record<DomainStatus, StatusMeta> = {
  pending_dns: { label: "DNS en attente", tone: "warning", icon: Clock },
  verifying: {
    label: "Vérification en cours",
    tone: "info",
    icon: RefreshCw,
    pulse: true,
  },
  issuing_certificate: {
    label: "Émission du certificat",
    tone: "info",
    icon: ShieldEllipsis,
    pulse: true,
  },
  active: { label: "Actif", tone: "success", icon: Globe },
  error: { label: "Erreur", tone: "danger", icon: TriangleAlert },
};

export const SSL_STATUS: Record<SslStatus, StatusMeta> = {
  none: { label: "Sans certificat", tone: "neutral", icon: ShieldOff },
  pending: { label: "En attente", tone: "warning", icon: ShieldEllipsis },
  issued: { label: "Valide", tone: "success", icon: ShieldCheck },
  error: { label: "Erreur", tone: "danger", icon: ShieldAlert },
};

export const BACKUP_STATUS: Record<BackupStatus, StatusMeta> = {
  in_progress: { label: "En cours", tone: "info", icon: RefreshCw, pulse: true },
  completed: { label: "Terminée", tone: "success", icon: CircleCheck },
  failed: { label: "Échec", tone: "danger", icon: CircleX },
};

/** Every status map, keyed by the `kind` prop of `<StatusBadge>`. */
export const STATUS_MAPS = {
  service: SERVICE_STATUS,
  deployment: DEPLOYMENT_STATUS,
  container: CONTAINER_STATE,
  health: CONTAINER_HEALTH,
  domain: DOMAIN_STATUS,
  ssl: SSL_STATUS,
  backup: BACKUP_STATUS,
} as const;

export type StatusKind = keyof typeof STATUS_MAPS;

/** Pairs each kind with its own status union (prop type of `<StatusBadge>`). */
export type StatusOf = {
  [Kind in StatusKind]: {
    kind: Kind;
    status: keyof (typeof STATUS_MAPS)[Kind];
  };
}[StatusKind];

export function getStatusMeta({ kind, status }: StatusOf): StatusMeta {
  const map: Record<string, StatusMeta> = STATUS_MAPS[kind];
  return map[status];
}

/** A container that exited with a non-zero code crashed: danger, not neutral. */
export function getContainerStateMeta(
  state: ContainerState,
  exitCode?: number | null,
): StatusMeta {
  if (state === "exited" && exitCode != null && exitCode !== 0) {
    return { label: `Arrêté (code ${exitCode})`, tone: "danger", icon: CircleX };
  }
  return CONTAINER_STATE[state];
}

// ─────────────────────────────────────────────────────────────────────────────
// Predicates
// ─────────────────────────────────────────────────────────────────────────────

/** queued, building or deploying: can be cancelled, shows live progress. */
export function isDeploymentInFlight(status: DeploymentStatus): boolean {
  return status === "queued" || status === "building" || status === "deploying";
}

export function isDeploymentFinished(status: DeploymentStatus): boolean {
  return !isDeploymentInFlight(status);
}

/** Only a past successful deployment (`removed`) can be restored. */
export function canRollbackTo(status: DeploymentStatus): boolean {
  return status === "removed";
}

/** building, deploying or restarting: lifecycle actions should be disabled. */
export function isServiceBusy(status: ServiceStatus): boolean {
  return status === "building" || status === "deploying" || status === "restarting";
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  github: "Dépôt GitHub",
  docker: "Image Docker",
  postgres: "PostgreSQL",
};

export const DEPLOYMENT_TRIGGER_LABELS: Record<DeploymentTrigger, string> = {
  initial: "Premier déploiement",
  push: "Push Git",
  manual: "Déploiement manuel",
  redeploy: "Redéploiement",
  rollback: "Restauration",
  config: "Changement de configuration",
};

export const ACTIVITY_SEVERITY: Record<
  ActivitySeverity,
  { tone: StatusTone; icon: LucideIcon }
> = {
  info: { tone: "info", icon: Info },
  success: { tone: "success", icon: CircleCheck },
  warning: { tone: "warning", icon: TriangleAlert },
  error: { tone: "danger", icon: CircleAlert },
};

/** Shortcut when only the tone of an activity event is needed. */
export const ACTIVITY_SEVERITY_TONE: Record<ActivitySeverity, StatusTone> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "danger",
};

/** Text colour of a log line, by level. */
export const LOG_LEVEL_CLASSES: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground/90",
  warn: "text-warning",
  error: "text-destructive",
  success: "text-success",
};

export const LOG_LEVEL: Record<LogLevel, { label: string; text: string }> = {
  debug: { label: "Debug", text: LOG_LEVEL_CLASSES.debug },
  info: { label: "Info", text: LOG_LEVEL_CLASSES.info },
  warn: { label: "Avertissement", text: LOG_LEVEL_CLASSES.warn },
  error: { label: "Erreur", text: LOG_LEVEL_CLASSES.error },
  success: { label: "Succès", text: LOG_LEVEL_CLASSES.success },
};

export const LOG_STREAM_LABELS: Record<LogStream, string> = {
  build: "Build",
  deploy: "Deploy",
  runtime: "Runtime",
};
