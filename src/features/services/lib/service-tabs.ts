import type { ServiceTab } from "@/lib/routes";
import type { ServiceType } from "@/lib/types";

export const SERVICE_TAB_LABELS: Record<ServiceTab, string> = {
  deployments: "Déploiements",
  variables: "Variables",
  metrics: "Métriques",
  logs: "Logs",
  data: "Données",
  console: "Console",
  connect: "Connexion",
  backups: "Sauvegardes",
  settings: "Réglages",
};

const APP_TABS: readonly ServiceTab[] = [
  "deployments",
  "variables",
  "metrics",
  "logs",
  "settings",
];

const DATABASE_TABS: readonly ServiceTab[] = [
  "data",
  "console",
  "connect",
  "backups",
  "variables",
  "metrics",
  "deployments",
  "settings",
];

/** Tabs of a service panel, in display order; the first one is the default. */
export function tabsForType(type: ServiceType): readonly ServiceTab[] {
  return type === "postgres" ? DATABASE_TABS : APP_TABS;
}

/** An invalid or missing `?tab=` falls back to the default tab of the type. */
export function resolveServiceTab(raw: string | null, type: ServiceType): ServiceTab {
  const tabs = tabsForType(type);
  return tabs.find((tab) => tab === raw) ?? tabs[0];
}
