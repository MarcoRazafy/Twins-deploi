import {
  Bell,
  FolderKanban,
  KeyRound,
  Plug,
  Server,
  SlidersHorizontal,
  SquareTerminal,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";

import type { IconComponent } from "@/components/shared/render-icon";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/routes";

export interface SectionMeta {
  value: SettingsSection;
  label: string;
  icon: IconComponent;
}

export const SECTION_META: ReadonlyArray<SectionMeta> = [
  { value: "general", label: "Général", icon: SlidersHorizontal },
  { value: "profile", label: "Profil", icon: UserRound },
  { value: "projects", label: "Projets", icon: FolderKanban },
  { value: "members", label: "Membres", icon: Users },
  { value: "tokens", label: "Jetons d’API", icon: KeyRound },
  { value: "integrations", label: "Intégrations", icon: Plug },
  { value: "infrastructure", label: "Infrastructure", icon: Server },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "console", label: "Console du serveur", icon: SquareTerminal },
  { value: "danger", label: "Zone de danger", icon: TriangleAlert },
];

export function parseSection(value: string | null): SettingsSection {
  return SETTINGS_SECTIONS.find((section) => section === value) ?? "general";
}
