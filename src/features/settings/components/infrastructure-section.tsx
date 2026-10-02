"use client";

import { Slider } from "@/components/ui/slider";
import { CodeBlock } from "@/components/shared/code-block";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMegabytes, formatNumber } from "@/lib/format";
import { useSettings, useUpdateSettings } from "@/lib/queries";
import type { PlatformSettings } from "@/lib/types";

import { useSettingsForm } from "../hooks/use-settings-form";
import { buildDnsRecords } from "../lib/dns-records";
import { buildNginxSnippet } from "../lib/nginx";
import {
  parseNumber,
  validateHostname,
  validateIntegerRange,
  validateIpv4,
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

const MEMORY_STEPS_MB = [128, 256, 512, 1024, 2048, 4096, 8192, 16384];

function DockerLimitsCard({ settings }: { settings: PlatformSettings }) {
  const update = useUpdateSettings();
  const current = settings.docker;
  const form = useSettingsForm({
    initial: {
      cpu: current.defaultCpuLimit,
      memoryMb: String(current.defaultMemoryLimitMb),
      autoPrune: current.autoPrune,
    },
    validate: (values) => ({
      cpu: values.cpu >= 0.25 && values.cpu <= 8 ? undefined : "La limite doit être comprise entre 0,25 et 8 vCPU.",
      memoryMb: validateIntegerRange(values.memoryMb, { min: 128, max: 16384, unit: "Mo" }),
    }),
    save: (values) =>
      update.mutateAsync({
        docker: {
          defaultCpuLimit: values.cpu,
          defaultMemoryLimitMb: parseNumber(values.memoryMb),
          autoPrune: values.autoPrune,
        },
      }),
    successMessage: "Limites Docker enregistrées",
    fieldMap: { "docker.defaultCpuLimit": "cpu", "docker.defaultMemoryLimitMb": "memoryMb" },
  });
  const { values, errors } = form;
  // A saved value that is not one of the presets stays selectable.
  const memoryOptions = Array.from(new Set([...MEMORY_STEPS_MB, parseNumber(values.memoryMb)]))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  return (
    <FormCard
      title="Docker"
      description="Limites de ressources appliquées aux conteneurs créés sans réglage propre."
      hint="Appliqué au prochain déploiement de chaque service."
      form={form}
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="docker-cpu"
            label="Limite de CPU par défaut"
            error={errors.cpu}
            description="De 0,25 à 8 vCPU, par pas de 0,25."
          >
            <div className="flex items-center gap-3 pt-1">
              <Slider
                id="docker-cpu"
                min={0.25}
                max={8}
                step={0.25}
                value={[values.cpu]}
                aria-label="Limite de CPU par défaut"
                onValueChange={([value]) => form.set("cpu", value)}
              />
              <span className="w-18 shrink-0 text-right text-sm tabular-nums">
                {formatNumber(values.cpu)} vCPU
              </span>
            </div>
          </FormField>
          <FormField id="docker-memory" label="Limite de mémoire par défaut" error={errors.memoryMb}>
            <Select value={values.memoryMb} onValueChange={(value) => form.set("memoryMb", value)}>
              <SelectTrigger id="docker-memory" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {memoryOptions.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {formatMegabytes(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <SwitchRow
          id="docker-prune"
          label="Nettoyage automatique"
          description="Supprimer régulièrement les images et conteneurs inutilisés."
          checked={values.autoPrune}
          onCheckedChange={(checked) => form.set("autoPrune", checked)}
        />
      </div>
    </FormCard>
  );
}

function NginxCard({ settings }: { settings: PlatformSettings }) {
  const update = useUpdateSettings();
  const current = settings.nginx;
  const form = useSettingsForm({
    initial: {
      clientMaxBodySizeMb: String(current.clientMaxBodySizeMb),
      proxyReadTimeoutSec: String(current.proxyReadTimeoutSec),
      gzip: current.gzip,
      http2: current.http2,
      forceHttps: current.forceHttps,
    },
    validate: (values) => ({
      clientMaxBodySizeMb: validateIntegerRange(values.clientMaxBodySizeMb, { min: 1, max: 1024, unit: "Mo" }),
      proxyReadTimeoutSec: validateIntegerRange(values.proxyReadTimeoutSec, { min: 1, max: 3600, unit: "secondes" }),
    }),
    save: (values) =>
      update.mutateAsync({
        nginx: {
          clientMaxBodySizeMb: parseNumber(values.clientMaxBodySizeMb),
          proxyReadTimeoutSec: parseNumber(values.proxyReadTimeoutSec),
          gzip: values.gzip,
          http2: values.http2,
          forceHttps: values.forceHttps,
        },
      }),
    successMessage: "Configuration NGINX enregistrée",
    fieldMap: {
      "nginx.clientMaxBodySizeMb": "clientMaxBodySizeMb",
      "nginx.proxyReadTimeoutSec": "proxyReadTimeoutSec",
    },
  });
  const { values, errors } = form;
  const snippet = buildNginxSnippet({ baseDomain: settings.baseDomain, ...values });

  return (
    <FormCard
      title="NGINX"
      description="Le reverse proxy qui expose vos services sur leurs domaines."
      hint="La configuration est rechargée sans coupure."
      form={form}
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="nginx-body"
            label="client_max_body_size"
            description="Taille maximale d’une requête (1 à 1024 Mo)."
            error={errors.clientMaxBodySizeMb}
          >
            <UnitInput
              id="nginx-body"
              unit="Mo"
              value={values.clientMaxBodySizeMb}
              invalid={Boolean(errors.clientMaxBodySizeMb)}
              describedBy={describedBy("nginx-body", true, errors.clientMaxBodySizeMb)}
              onChange={(value) => form.set("clientMaxBodySizeMb", value)}
              onBlur={() => form.blur("clientMaxBodySizeMb")}
            />
          </FormField>
          <FormField
            id="nginx-timeout"
            label="proxy_read_timeout"
            description="Attente maximale d’une réponse (1 à 3 600 s)."
            error={errors.proxyReadTimeoutSec}
          >
            <UnitInput
              id="nginx-timeout"
              unit="s"
              value={values.proxyReadTimeoutSec}
              invalid={Boolean(errors.proxyReadTimeoutSec)}
              describedBy={describedBy("nginx-timeout", true, errors.proxyReadTimeoutSec)}
              onChange={(value) => form.set("proxyReadTimeoutSec", value)}
              onBlur={() => form.blur("proxyReadTimeoutSec")}
            />
          </FormField>
        </div>
        <div className="space-y-4">
          <SwitchRow
            id="nginx-gzip"
            label="Compression gzip"
            description="Compresser les réponses texte pour réduire la bande passante."
            checked={values.gzip}
            onCheckedChange={(checked) => form.set("gzip", checked)}
          />
          <SwitchRow
            id="nginx-http2"
            label="HTTP/2"
            description="Multiplexer les requêtes sur une seule connexion."
            checked={values.http2}
            onCheckedChange={(checked) => form.set("http2", checked)}
          />
          <SwitchRow
            id="nginx-https"
            label="Forcer HTTPS"
            description="Rediriger tout le trafic HTTP vers HTTPS."
            checked={values.forceHttps}
            onCheckedChange={(checked) => form.set("forceHttps", checked)}
          />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Aperçu de la configuration</h3>
          <CodeBlock code={snippet} language="nginx" title="nginx.conf" maxHeight={340} />
        </div>
      </div>
    </FormCard>
  );
}

function DnsCard({ settings }: { settings: PlatformSettings }) {
  const update = useUpdateSettings();
  const current = settings.dns;
  const form = useSettingsForm({
    initial: { provider: current.provider as "manual" | "cloudflare", serverIp: current.serverIp, cnameTarget: current.cnameTarget },
    validate: (values) => ({
      serverIp: validateIpv4(values.serverIp),
      cnameTarget: validateHostname(values.cnameTarget, "ingress.exemple.mg"),
    }),
    save: (values) =>
      update.mutateAsync({
        dns: { provider: values.provider, serverIp: values.serverIp, cnameTarget: values.cnameTarget.toLowerCase() },
      }),
    successMessage: "Configuration DNS enregistrée",
    fieldMap: { "dns.serverIp": "serverIp", "dns.cnameTarget": "cnameTarget" },
  });
  const { values, errors } = form;
  const records = buildDnsRecords(values);

  return (
    <FormCard
      title="DNS"
      description="Les enregistrements demandés à vos utilisateurs pour un domaine personnalisé."
      hint="Les domaines existants sont revérifiés après l’enregistrement."
      form={form}
    >
      <div className="space-y-5">
        <FormField id="dns-provider" label="Fournisseur">
          <ToggleGroup
            id="dns-provider"
            type="single"
            variant="outline"
            value={values.provider}
            aria-label="Fournisseur DNS"
            onValueChange={(value) => {
              if (value === "manual" || value === "cloudflare") form.set("provider", value);
            }}
          >
            <ToggleGroupItem value="manual" className="px-4">
              Manuel
            </ToggleGroupItem>
            <ToggleGroupItem value="cloudflare" className="px-4">
              Cloudflare
            </ToggleGroupItem>
          </ToggleGroup>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="dns-ip"
            label="IP du serveur"
            description="Cible des enregistrements A."
            error={errors.serverIp}
          >
            <Input
              id="dns-ip"
              value={values.serverIp}
              inputMode="decimal"
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-[13px]"
              aria-invalid={errors.serverIp ? true : undefined}
              aria-describedby={describedBy("dns-ip", true, errors.serverIp)}
              onChange={(event) => form.set("serverIp", event.target.value)}
              onBlur={() => form.blur("serverIp")}
            />
          </FormField>
          <FormField
            id="dns-cname"
            label="Cible CNAME"
            description="Cible des enregistrements CNAME."
            error={errors.cnameTarget}
          >
            <Input
              id="dns-cname"
              value={values.cnameTarget}
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-[13px]"
              aria-invalid={errors.cnameTarget ? true : undefined}
              aria-describedby={describedBy("dns-cname", true, errors.cnameTarget)}
              onChange={(event) => form.set("cnameTarget", event.target.value)}
              onBlur={() => form.blur("cnameTarget")}
            />
          </FormField>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Enregistrements à créer</h3>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Valeur</TableHead>
                  <TableHead className="hidden sm:table-cell">Pour</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={`${record.type}-${record.name}`}>
                    <TableCell className="font-mono text-[13px] font-medium">{record.type}</TableCell>
                    <TableCell className="font-mono text-[13px]">{record.name}</TableCell>
                    <TableCell className="font-mono text-[13px] break-all">{record.value}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{record.usage}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {values.provider === "cloudflare" ? (
            <p className="text-xs text-muted-foreground">
              Avec Cloudflare, désactivez le proxy (nuage gris) tant que le certificat SSL n’est pas émis.
            </p>
          ) : null}
        </div>
      </div>
    </FormCard>
  );
}

export function InfrastructureSection() {
  const query = useSettings();
  return (
    <QueryBoundary
      query={query}
      skeleton={
        <div className="space-y-6">
          <FormCardSkeleton fields={2} />
          <FormCardSkeleton fields={3} />
          <FormCardSkeleton fields={2} />
        </div>
      }
    >
      {(settings) => (
        <div className="space-y-6">
          <DockerLimitsCard
            key={`${settings.docker.defaultCpuLimit}|${settings.docker.defaultMemoryLimitMb}|${settings.docker.autoPrune}`}
            settings={settings}
          />
          <NginxCard key={JSON.stringify(settings.nginx)} settings={settings} />
          <DnsCard key={JSON.stringify(settings.dns)} settings={settings} />
        </div>
      )}
    </QueryBoundary>
  );
}
