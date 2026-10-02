"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Globe, Link2, Unplug } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { DockerIcon, GithubIcon, NginxIcon } from "@/components/icons/brand-icons";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { hoverLift } from "@/lib/motion";
import { useDisconnectGithub, useGithubConnection, useSettings, useUpdateSettings } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { PlatformSettings } from "@/lib/types";

import { useSettingsForm } from "../hooks/use-settings-form";
import { notifyError } from "../lib/errors";
import { validateAbsolutePath, validateUrl } from "../lib/validation";
import { FormCard, FormCardSkeleton, FormField, QueryBoundary, describedBy } from "./form-parts";

function GithubCard() {
  const query = useGithubConnection();
  const disconnect = useDisconnectGithub();
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function confirmDisconnect() {
    try {
      await disconnect.mutateAsync();
      toast.success("GitHub déconnecté");
      setConfirmOpen(false);
    } catch (error) {
      notifyError(error);
    }
  }

  const connection = query.data;
  const connected = connection?.connected === true;

  return (
    <>
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <GithubIcon className="size-4" />
            GitHub
          </span>
        }
        description="Importez des dépôts et déployez-les à chaque push."
        actions={
          connection === undefined ? null : connected ? (
            <>
              <Button asChild variant="outline">
                <Link href={routes.github()}>Gérer</Link>
              </Button>
              <Button variant="outline" onClick={() => setConfirmOpen(true)}>
                <Unplug data-icon="inline-start" />
                Déconnecter
              </Button>
            </>
          ) : (
            <Button asChild>
              <Link href={routes.github()}>
                <Link2 data-icon="inline-start" />
                Connecter
              </Link>
            </Button>
          )
        }
      >
        <QueryBoundary
          query={query}
          skeleton={
            <div aria-busy className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          }
        >
          {(data) =>
            data.connected && data.account ? (
              <div className="space-y-3 rounded-lg bg-secondary px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StatusBadge kind="domain" status="active" label="Connecté" size="sm" />
                  <span className="font-mono text-[13px]">@{data.account.login}</span>
                  {data.connectedAt ? (
                    <span className="text-xs text-muted-foreground">depuis le {formatDate(data.connectedAt)}</span>
                  ) : null}
                </div>
                {data.organizations.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Organisations</span>
                    {data.organizations.map((organization) => (
                      <Badge key={organization.id} variant="outline" className="font-mono">
                        {organization.login}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aucun compte connecté. La connexion se fait avec un jeton d’accès personnel, depuis la page GitHub.
              </p>
            )
          }
        </QueryBoundary>
      </SectionCard>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title="Déconnecter GitHub"
        description="Les services déjà importés continuent de tourner, mais les nouveaux push ne déclencheront plus de déploiement."
        confirmLabel="Déconnecter"
        loading={disconnect.isPending}
        onConfirm={confirmDisconnect}
      />
    </>
  );
}

function DockerCard({ settings }: { settings: PlatformSettings }) {
  const update = useUpdateSettings();
  const form = useSettingsForm({
    initial: { socketPath: settings.docker.socketPath, registryUrl: settings.docker.registryUrl },
    validate: (values) => ({
      socketPath: validateAbsolutePath(values.socketPath),
      registryUrl: validateUrl(values.registryUrl),
    }),
    save: (values) => update.mutateAsync({ docker: values }),
    successMessage: "Connexion Docker enregistrée",
    fieldMap: { "docker.socketPath": "socketPath", "docker.registryUrl": "registryUrl" },
  });
  const { values, errors } = form;

  return (
    <FormCard
      title={
        <span className="flex items-center gap-2">
          <DockerIcon className="size-4" />
          Docker
        </span>
      }
      description="Où la plateforme joint le démon Docker et le registre d’images."
      hint="Les limites de ressources se règlent dans Infrastructure."
      form={form}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="docker-socket" label="Chemin du socket" error={errors.socketPath}>
          <Input
            id="docker-socket"
            value={values.socketPath}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-[13px]"
            aria-invalid={errors.socketPath ? true : undefined}
            aria-describedby={describedBy("docker-socket", false, errors.socketPath)}
            onChange={(event) => form.set("socketPath", event.target.value)}
            onBlur={() => form.blur("socketPath")}
          />
        </FormField>
        <FormField id="docker-registry" label="URL du registre" error={errors.registryUrl}>
          <Input
            id="docker-registry"
            value={values.registryUrl}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-[13px]"
            aria-invalid={errors.registryUrl ? true : undefined}
            aria-describedby={describedBy("docker-registry", false, errors.registryUrl)}
            onChange={(event) => form.set("registryUrl", event.target.value)}
            onBlur={() => form.blur("registryUrl")}
          />
        </FormField>
      </div>
    </FormCard>
  );
}

interface SummaryCardProps {
  icon: React.ReactNode;
  title: string;
  summary: string;
}

function SummaryCard({ icon, title, summary }: SummaryCardProps) {
  return (
    <motion.div {...hoverLift} className="h-full">
      <Link
        href={routes.settings("infrastructure")}
        className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-border-strong hover:bg-secondary/40 sm:p-5"
      >
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            {icon}
          </span>
          <h3 className="text-base font-medium">{title}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{summary}</p>
        <span className="mt-auto inline-flex items-center gap-1 text-sm text-brand-400">
          Configurer
          <ArrowRight className="size-3.5" />
        </span>
      </Link>
    </motion.div>
  );
}

function InfrastructureSummaries({ settings }: { settings: PlatformSettings }) {
  const { nginx, dns } = settings;
  const nginxSummary = [
    `Requêtes jusqu’à ${nginx.clientMaxBodySizeMb} Mo`,
    `délai ${nginx.proxyReadTimeoutSec} s`,
    nginx.http2 ? "HTTP/2" : null,
    nginx.gzip ? "gzip" : null,
    nginx.forceHttps ? "HTTPS forcé" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const dnsSummary = `${dns.provider === "cloudflare" ? "Cloudflare" : "Manuel"} · IP ${dns.serverIp} · CNAME ${dns.cnameTarget}`;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SummaryCard icon={<NginxIcon className="size-4" />} title="NGINX" summary={nginxSummary} />
      <SummaryCard icon={<Globe className="size-4" />} title="DNS" summary={dnsSummary} />
    </div>
  );
}

export function IntegrationsSection() {
  const settings = useSettings();

  return (
    <div className="space-y-6">
      <GithubCard />
      <QueryBoundary query={settings} skeleton={<FormCardSkeleton fields={2} />}>
        {(data) => <DockerCard key={JSON.stringify(data.docker)} settings={data} />}
      </QueryBoundary>
      <QueryBoundary
        query={settings}
        skeleton={
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        }
      >
        {(data) => <InfrastructureSummaries settings={data} />}
      </QueryBoundary>
    </div>
  );
}
