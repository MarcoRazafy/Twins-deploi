"use client";

import { useState } from "react";
import {
  Activity,
  Database,
  KeyRound,
  Plus,
  RotateCw,
  ScrollText,
  Settings,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { UnderlineTabs, type UnderlineTab } from "@/components/shared/underline-tabs";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { KitExample, KitSection } from "./kit-section";

const SERVICE_TABS: UnderlineTab[] = [
  { value: "deployments", label: "Déploiements", icon: Activity, count: 12 },
  { value: "variables", label: "Variables", icon: KeyRound, count: 8 },
  { value: "logs", label: "Logs", icon: ScrollText },
  { value: "data", label: "Données", icon: Database, disabled: true },
  { value: "settings", label: "Réglages", icon: Settings },
];

const TAB_COPY: Record<string, string> = {
  deployments: "Historique des déploiements du service, du plus récent au plus ancien.",
  variables: "Variables d’environnement du service et variables partagées du projet.",
  logs: "Sortie du conteneur en temps réel.",
  settings: "Source, build, réseau et zone de danger.",
};

export function LayoutSection() {
  const [tab, setTab] = useState("deployments");
  const [autoDeploy, setAutoDeploy] = useState(true);

  return (
    <KitSection
      id="mise-en-page"
      title="Mise en page"
      description="Le cadre commun des pages : en-tête, blocs de réglages et onglets soulignés. PageContainer fournit la largeur, les marges et l’animation d’entrée."
    >
      <KitExample title="En-tête de page" code="<PageHeader />" bodyClassName="space-y-6">
        <PageHeader
          title="CanCham Connect"
          description="Site des adhérents et API de la Chambre de commerce. 4 services, 1 base de données."
          icon={<ProjectAvatar name="CanCham Connect" color="purple" size="lg" />}
          badge={<StatusBadge kind="service" status="online" />}
          backHref="/dev/kit?section=mise-en-page"
          backLabel="Tous les projets"
          actions={
            <>
              <Button variant="outline">
                <Settings data-icon="inline-start" />
                Réglages
              </Button>
              <Button>
                <Plus data-icon="inline-start" />
                Nouveau service
              </Button>
            </>
          }
        />
      </KitExample>

      <KitExample title="Onglets soulignés" code="<UnderlineTabs />" bodyClassName="space-y-4">
        <UnderlineTabs
          tabs={SERVICE_TABS}
          value={tab}
          onValueChange={setTab}
          label="Sections du service"
          idBase="kit-service"
        />
        <p
          id={`kit-service-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`kit-service-tab-${tab}`}
          className="text-sm text-muted-foreground"
        >
          {TAB_COPY[tab]}
        </p>
      </KitExample>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard
          title="Déploiement automatique"
          description="Redéployer le service à chaque push sur la branche suivie."
          actions={
            <Switch
              checked={autoDeploy}
              onCheckedChange={setAutoDeploy}
              aria-label="Déploiement automatique"
            />
          }
          footer={
            <>
              <span>La modification s’applique au prochain push.</span>
              <Button size="sm" onClick={() => toast.success("Réglages enregistrés")}>
                Enregistrer
              </Button>
            </>
          }
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="kit-branch">Branche suivie</FieldLabel>
              <Input id="kit-branch" defaultValue="main" disabled={!autoDeploy} />
              <FieldDescription>
                Seuls les commits de cette branche déclenchent un déploiement.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </SectionCard>

        <SectionCard
          tone="danger"
          title="Zone de danger"
          description="Ces actions sont irréversibles. Elles demandent toujours une confirmation."
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">Supprimer le service</p>
              <p className="text-sm text-muted-foreground">
                Supprime aussi ses déploiements, ses variables et ses domaines.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline">
                <RotateCw data-icon="inline-start" />
                Redémarrer
              </Button>
              <Button variant="destructive">
                <Trash2 data-icon="inline-start" />
                Supprimer
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>
    </KitSection>
  );
}
