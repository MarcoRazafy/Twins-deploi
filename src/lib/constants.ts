import type { MemberRole, MetricRange, ProjectColor, Region } from "@/lib/types";

export const APP_NAME = "Mini Railway";
export const APP_DESCRIPTION =
  "Hébergez et pilotez vos applications, bases PostgreSQL, conteneurs Docker et domaines depuis un seul espace de travail.";

/** Display name used as the author of local actions. */
export const CURRENT_USER_NAME = "Marco Razafy";

export const REGION_LABELS: Record<Region, string> = {
  "eu-west": "Europe de l’Ouest · Paris",
  "us-east": "US Est · Virginie",
  "af-south": "Afrique australe · Johannesburg",
  "ap-southeast": "Asie du Sud-Est · Singapour",
};

export const POSTGRES_VERSIONS = ["17", "16", "15"] as const;

export const METRIC_RANGE_LABELS: Record<MetricRange, string> = {
  "1h": "1 h",
  "6h": "6 h",
  "24h": "24 h",
  "7d": "7 j",
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  developer: "Développeur",
  viewer: "Lecteur",
};

/**
 * Tailwind classes for the project accent (avatar tile, dots).
 * Listed in full so Tailwind can see them.
 */
export const PROJECT_COLOR_CLASSES: Record<
  ProjectColor,
  { bg: string; text: string; dot: string }
> = {
  purple: { bg: "bg-brand-600/15", text: "text-brand-400", dot: "bg-brand-500" },
  blue: { bg: "bg-info/15", text: "text-info", dot: "bg-info" },
  green: { bg: "bg-success/15", text: "text-success", dot: "bg-success" },
  amber: { bg: "bg-warning/15", text: "text-warning", dot: "bg-warning" },
  pink: { bg: "bg-pink-500/15", text: "text-pink-400", dot: "bg-pink-400" },
  cyan: { bg: "bg-cyan-500/15", text: "text-cyan-400", dot: "bg-cyan-400" },
};

/**
 * Geometry of workspace service cards, in canvas units. Shared by the canvas
 * (drawing, connections) and the backend (auto-placement of new services).
 */
export const CANVAS = {
  cardWidth: 272,
  cardHeight: 136,
  /** Height of the volume footer attached under a card. */
  volumeHeight: 44,
  /** Dot grid spacing, also the snap step. */
  grid: 24,
  minZoom: 0.4,
  maxZoom: 1.75,
} as const;

/** localStorage keys (all prefixed so the demo data is easy to wipe). */
export const STORAGE_KEYS = {
  db: "mini-railway:db",
  ui: "mini-railway:ui",
  workspace: "mini-railway:workspace",
} as const;
