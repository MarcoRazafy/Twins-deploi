"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Bell,
  ChartLine,
  Gauge,
  MousePointerClick,
  Palette,
  PanelsTopLeft,
  Sparkles,
  SquareTerminal,
  Table2,
  TextCursorInput,
} from "lucide-react";

import { LogoMark } from "@/components/shared/logo";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { UnderlineTabs, type UnderlineTab } from "@/components/shared/underline-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useQueryParam } from "@/hooks/use-query-param";
import { routes } from "@/lib/routes";

import { ButtonsSection } from "./buttons-section";
import { ChartsSection } from "./charts-section";
import { DataSection } from "./data-section";
import { FeedbackSection } from "./feedback-section";
import { FormsSection } from "./forms-section";
import { FoundationsSection } from "./foundations-section";
import { LayoutSection } from "./layout-section";
import { LogsSection } from "./logs-section";
import { MotionSection } from "./motion-section";
import { StatusSection } from "./status-section";
import { TablesSection } from "./tables-section";

const ALL = "tout";

const SECTION_TABS: UnderlineTab[] = [
  { value: ALL, label: "Tout" },
  { value: "fondations", label: "Fondations", icon: Palette },
  { value: "mise-en-page", label: "Mise en page", icon: PanelsTopLeft },
  { value: "boutons", label: "Boutons", icon: MousePointerClick },
  { value: "statuts", label: "Statuts", icon: Activity },
  { value: "donnees", label: "Données", icon: Gauge },
  { value: "graphiques", label: "Graphiques", icon: ChartLine },
  { value: "formulaires", label: "Formulaires", icon: TextCursorInput },
  { value: "tableaux", label: "Tableaux", icon: Table2 },
  { value: "logs", label: "Logs et code", icon: SquareTerminal },
  { value: "retours", label: "Retours", icon: Bell },
  { value: "mouvement", label: "Mouvement", icon: Sparkles },
];

/**
 * Style guide of the shared kit: every component of `components/shared` in
 * its meaningful states. The active section lives in `?section=`.
 */
export function KitView() {
  const [section, setSection] = useQueryParam("section");
  const [loading, setLoading] = useState(false);

  const active = SECTION_TABS.some((tab) => tab.value === section) ? (section ?? ALL) : ALL;
  const shows = (id: string) => active === ALL || active === id;

  return (
    <PageContainer>
      <PageHeader
        title="Kit UI"
        description="Les briques partagées de TwinsDeploi, dans tous leurs états. Chaque écran de l’application est un assemblage de ces composants."
        icon={<LogoMark className="size-10" />}
        badge={<Badge variant="outline">components/shared</Badge>}
        actions={
          <>
            <div className="flex h-8 items-center gap-2 rounded-lg border bg-card px-2.5">
              <Switch id="kit-loading" size="sm" checked={loading} onCheckedChange={setLoading} />
              <Label htmlFor="kit-loading" className="font-normal text-muted-foreground">
                États de chargement
              </Label>
            </div>
            <Button variant="outline" asChild>
              <Link href={routes.dashboard()}>
                Ouvrir l’application
                <ArrowUpRight data-icon="inline-end" />
              </Link>
            </Button>
          </>
        }
      />

      <div className="sticky top-0 z-10 -mx-4 -mt-2 bg-background/85 px-4 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <UnderlineTabs
          tabs={SECTION_TABS}
          value={active}
          onValueChange={(next) => setSection(next === ALL ? null : next)}
          label="Sections du kit"
        />
      </div>

      {shows("fondations") ? <FoundationsSection /> : null}
      {shows("mise-en-page") ? <LayoutSection /> : null}
      {shows("boutons") ? <ButtonsSection /> : null}
      {shows("statuts") ? <StatusSection /> : null}
      {shows("donnees") ? <DataSection loading={loading} /> : null}
      {shows("graphiques") ? <ChartsSection loading={loading} /> : null}
      {shows("formulaires") ? <FormsSection /> : null}
      {shows("tableaux") ? <TablesSection loading={loading} /> : null}
      {shows("logs") ? <LogsSection loading={loading} /> : null}
      {shows("retours") ? <FeedbackSection loading={loading} /> : null}
      {shows("mouvement") ? <MotionSection /> : null}
    </PageContainer>
  );
}
