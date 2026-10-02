"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { REGION_LABELS } from "@/lib/constants";
import { useSettings, useUpdateSettings } from "@/lib/queries";
import { REGIONS, type Builder, type PlatformSettings, type Region } from "@/lib/types";

import { useSettingsForm } from "../hooks/use-settings-form";
import {
  parseNumber,
  validateHostname,
  validateIntegerRange,
  validateText,
} from "../lib/validation";
import {
  FormCard,
  FormCardSkeleton,
  FormField,
  QueryBoundary,
  SwitchRow,
  UnitInput,
  describedBy,
} from "./form-parts";

const BUILDER_LABELS: Record<Builder, string> = {
  nixpacks: "Nixpacks (détection automatique)",
  dockerfile: "Dockerfile du dépôt",
};
const BUILDERS: Builder[] = ["nixpacks", "dockerfile"];

function WorkspaceCard({ settings }: { settings: PlatformSettings }) {
  const update = useUpdateSettings();
  const form = useSettingsForm({
    initial: {
      workspaceName: settings.workspaceName,
      baseDomain: settings.baseDomain,
      defaultRegion: settings.defaultRegion as Region,
    },
    validate: (values) => ({
      workspaceName: validateText(values.workspaceName, { min: 2, max: 40, label: "Le nom" }),
      baseDomain: validateHostname(values.baseDomain, "up.exemple.mg"),
    }),
    save: (values) =>
      update.mutateAsync({
        workspaceName: values.workspaceName,
        baseDomain: values.baseDomain.toLowerCase(),
        defaultRegion: values.defaultRegion,
      }),
    successMessage: "Réglages généraux enregistrés",
  });
  const { values, errors } = form;
  const exampleHost = `mon-api-7k2x.${values.baseDomain.trim().toLowerCase() || "up.exemple.mg"}`;

  return (
    <FormCard
      title="Espace de travail"
      description="Le nom affiché dans l’interface et le domaine utilisé pour les adresses générées."
      hint="Appliqué aux nouveaux domaines générés."
      form={form}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="workspace-name" label="Nom de l’espace de travail" error={errors.workspaceName}>
          <Input
            id="workspace-name"
            value={values.workspaceName}
            autoComplete="off"
            aria-invalid={errors.workspaceName ? true : undefined}
            aria-describedby={describedBy("workspace-name", false, errors.workspaceName)}
            onChange={(event) => form.set("workspaceName", event.target.value)}
            onBlur={() => form.blur("workspaceName")}
          />
        </FormField>
        <FormField id="default-region" label="Région par défaut">
          <Select value={values.defaultRegion} onValueChange={(value) => form.set("defaultRegion", value as Region)}>
            <SelectTrigger id="default-region" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((region) => (
                <SelectItem key={region} value={region}>
                  {REGION_LABELS[region]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          id="base-domain"
          label="Domaine de base"
          className="sm:col-span-2"
          error={errors.baseDomain}
          description={
            <>
              Exemple d’adresse générée :{" "}
              <code className="font-mono text-[13px] break-all text-foreground">{exampleHost}</code>
            </>
          }
        >
          <Input
            id="base-domain"
            value={values.baseDomain}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[13px]"
            aria-invalid={errors.baseDomain ? true : undefined}
            aria-describedby={describedBy("base-domain", true, errors.baseDomain)}
            onChange={(event) => form.set("baseDomain", event.target.value)}
            onBlur={() => form.blur("baseDomain")}
          />
        </FormField>
      </div>
    </FormCard>
  );
}

function DeploymentsCard({ settings }: { settings: PlatformSettings }) {
  const update = useUpdateSettings();
  const current = settings.deployments;
  const form = useSettingsForm({
    initial: {
      autoDeploy: current.autoDeploy,
      buildTimeoutMin: String(current.buildTimeoutMin),
      retention: String(current.retention),
      defaultBuilder: current.defaultBuilder,
    },
    validate: (values) => ({
      buildTimeoutMin: validateIntegerRange(values.buildTimeoutMin, { min: 1, max: 120, unit: "minutes" }),
      retention: validateIntegerRange(values.retention, { min: 1, max: 100, unit: "déploiements" }),
    }),
    save: (values) =>
      update.mutateAsync({
        deployments: {
          autoDeploy: values.autoDeploy,
          buildTimeoutMin: parseNumber(values.buildTimeoutMin),
          retention: parseNumber(values.retention),
          defaultBuilder: values.defaultBuilder,
        },
      }),
    successMessage: "Réglages de déploiement enregistrés",
    fieldMap: {
      "deployments.buildTimeoutMin": "buildTimeoutMin",
      "deployments.retention": "retention",
    },
  });
  const { values, errors } = form;

  return (
    <FormCard
      title="Déploiements"
      description="Valeurs par défaut appliquées aux nouveaux services."
      hint="Les services existants gardent leurs réglages."
      form={form}
    >
      <div className="space-y-5">
        <SwitchRow
          id="auto-deploy"
          label="Déploiement automatique"
          description="Redéployer un service à chaque push sur sa branche."
          checked={values.autoDeploy}
          onCheckedChange={(checked) => form.set("autoDeploy", checked)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="build-timeout"
            label="Délai maximal de build"
            description="Entre 1 et 120 minutes."
            error={errors.buildTimeoutMin}
          >
            <UnitInput
              id="build-timeout"
              unit="min"
              value={values.buildTimeoutMin}
              invalid={Boolean(errors.buildTimeoutMin)}
              describedBy={describedBy("build-timeout", true, errors.buildTimeoutMin)}
              onChange={(value) => form.set("buildTimeoutMin", value)}
              onBlur={() => form.blur("buildTimeoutMin")}
            />
          </FormField>
          <FormField
            id="retention"
            label="Déploiements conservés"
            description="Versions gardées par service pour restaurer (1 à 100)."
            error={errors.retention}
          >
            <UnitInput
              id="retention"
              unit="versions"
              value={values.retention}
              invalid={Boolean(errors.retention)}
              describedBy={describedBy("retention", true, errors.retention)}
              onChange={(value) => form.set("retention", value)}
              onBlur={() => form.blur("retention")}
            />
          </FormField>
          <FormField id="default-builder" label="Builder par défaut">
            <Select
              value={values.defaultBuilder}
              onValueChange={(value) => form.set("defaultBuilder", value as Builder)}
            >
              <SelectTrigger id="default-builder" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUILDERS.map((builder) => (
                  <SelectItem key={builder} value={builder}>
                    {BUILDER_LABELS[builder]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </div>
    </FormCard>
  );
}

export function GeneralSection() {
  const query = useSettings();
  return (
    <QueryBoundary
      query={query}
      skeleton={
        <div className="space-y-6">
          <FormCardSkeleton fields={3} />
          <FormCardSkeleton fields={3} />
        </div>
      }
    >
      {(settings) => (
        <div className="space-y-6">
          <WorkspaceCard
            key={`${settings.workspaceName}|${settings.baseDomain}|${settings.defaultRegion}`}
            settings={settings}
          />
          <DeploymentsCard key={JSON.stringify(settings.deployments)} settings={settings} />
        </div>
      )}
    </QueryBoundary>
  );
}
