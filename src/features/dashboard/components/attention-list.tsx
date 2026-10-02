"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, Globe, Play, RotateCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { ErrorState } from "@/components/shared/error-state";
import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/lib/api/contract";
import { pluralize } from "@/lib/format";
import { SPRING, fadeUp } from "@/lib/motion";
import { useDomains, useProjects, useServiceAction, useServices } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { DOMAIN_STATUS, TONE_CLASSES } from "@/lib/status";
import type { Domain, ProjectSummary, Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DashboardCard, DashboardSection } from "./dashboard-section";

/** Rows shown before "Afficher les N autres": keeps the block as tall as the chart beside it. */
const MAX_VISIBLE = 4;
const SKELETON_ROWS = 3;

type AttentionItem =
  | { kind: "service"; id: string; rank: number; service: Service }
  | { kind: "domain"; id: string; rank: number; domain: Domain };

/** Most urgent first: crashed services, failed domains, domains waiting on DNS, stopped services. */
function collectAttentionItems(
  services: readonly Service[],
  domains: readonly Domain[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const service of services) {
    if (service.status === "crashed") {
      items.push({ kind: "service", id: `service:${service.id}`, rank: 0, service });
    } else if (service.status === "stopped") {
      items.push({ kind: "service", id: `service:${service.id}`, rank: 3, service });
    }
  }
  for (const domain of domains) {
    if (domain.status === "error") {
      items.push({ kind: "domain", id: `domain:${domain.id}`, rank: 1, domain });
    } else if (domain.status === "pending_dns") {
      items.push({ kind: "domain", id: `domain:${domain.id}`, rank: 2, domain });
    }
  }

  return items.sort((a, b) => a.rank - b.rank);
}

interface RowShellProps {
  tile: ReactNode;
  children: ReactNode;
  actions: ReactNode;
}

/**
 * Icon, text and actions. Narrow: the actions drop under the text. Wide (the
 * card is a container, so this follows the card and not the screen): one line.
 */
function RowShell({ tile, children, actions }: RowShellProps) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 px-4 py-3 sm:px-5 @md:grid-cols-[auto_minmax(0,1fr)_auto]">
      {tile}
      <div className="min-w-0 space-y-1">{children}</div>
      <div className="col-start-2 flex flex-wrap items-center gap-1.5 @md:col-start-3">{actions}</div>
    </div>
  );
}

interface ServiceRowProps {
  service: Service;
  projectName: string | undefined;
}

function ServiceRow({ service, projectName }: ServiceRowProps) {
  // One mutation per row: two rows can restart at the same time, each with its own spinner.
  const action = useServiceAction();
  const crashed = service.status === "crashed";

  async function handleAction() {
    try {
      await action.mutateAsync({ id: service.id, action: crashed ? "restart" : "start" });
      toast.success(crashed ? "Redémarrage lancé" : "Démarrage lancé", {
        description: service.name,
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <RowShell
      tile={<ServiceIcon type={service.source.type} tile="md" className="border" />}
      actions={
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={handleAction}
          >
            {action.isPending ? (
              <Spinner aria-hidden="true" className="size-3.5" />
            ) : crashed ? (
              <RotateCw data-icon="inline-start" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            {crashed ? "Redémarrer" : "Démarrer"}
          </Button>
          <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
            <Link
              href={routes.workspace(service.projectId, { service: service.id })}
              aria-label={`Ouvrir ${service.name} dans le workspace`}
            >
              Ouvrir
            </Link>
          </Button>
        </>
      }
    >
      <p className="truncate text-sm font-medium" title={service.name}>
        {service.name}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <StatusBadge kind="service" status={service.status} size="sm" />
        {projectName ? <span className="truncate">{projectName}</span> : null}
      </div>
    </RowShell>
  );
}

interface DomainRowProps {
  domain: Domain;
  projectName: string | undefined;
  serviceName: string | undefined;
}

function DomainRow({ domain, projectName, serviceName }: DomainRowProps) {
  const tone = TONE_CLASSES[DOMAIN_STATUS[domain.status].tone];
  const context = [projectName, serviceName].filter(Boolean).join(" · ");

  return (
    <RowShell
      tile={
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-lg border",
            tone.bg,
            tone.border,
            tone.text,
          )}
        >
          <Globe aria-hidden="true" className="size-[18px]" />
        </span>
      }
      actions={
        <Button asChild size="sm" variant="outline">
          <Link
            href={routes.domains({ project: domain.projectId, service: domain.serviceId })}
            aria-label={`Vérifier le DNS de ${domain.hostname}`}
          >
            Vérifier le DNS
          </Link>
        </Button>
      }
    >
      <p className="truncate font-mono text-[13px] font-medium" title={domain.hostname}>
        {domain.hostname}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <StatusBadge kind="domain" status={domain.status} size="sm" />
        {context ? <span className="truncate">{context}</span> : null}
      </div>
      {domain.status === "error" && domain.error ? (
        <p className="truncate text-xs text-destructive" title={domain.error}>
          {domain.error}
        </p>
      ) : null}
    </RowShell>
  );
}

function RowSkeleton() {
  return (
    <RowShell
      tile={<Skeleton className="size-9 rounded-lg" />}
      actions={
        <>
          <Skeleton className="h-7 w-24 rounded-lg" />
          <Skeleton className="h-7 w-16 rounded-lg" />
        </>
      }
    >
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-5 w-28" />
    </RowShell>
  );
}

function HealthyState() {
  const tone = TONE_CLASSES.success;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-full border",
          tone.bg,
          tone.border,
          tone.text,
        )}
      >
        <CircleCheck aria-hidden="true" className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">Tout est opérationnel</p>
        <p className="max-w-64 text-sm text-pretty text-muted-foreground">
          Aucun service en erreur ou arrêté, aucun domaine en attente de vérification.
        </p>
      </div>
    </div>
  );
}

export interface AttentionListProps {
  className?: string;
}

/** Crashed or stopped services and domains that are not live yet, each with its quick action. */
export function AttentionList({ className }: AttentionListProps) {
  const services = useServices();
  const domains = useDomains();
  const projects = useProjects();
  const [expanded, setExpanded] = useState(false);

  const serviceById = useMemo(
    () => new Map((services.data ?? []).map((service) => [service.id, service] as const)),
    [services.data],
  );
  const projectById = useMemo(
    () =>
      new Map<string, ProjectSummary>(
        (projects.data ?? []).map((project) => [project.id, project] as const),
      ),
    [projects.data],
  );
  const items = useMemo(
    () =>
      services.data && domains.data ? collectAttentionItems(services.data, domains.data) : null,
    [services.data, domains.data],
  );

  const loadFailed =
    (services.isError && !services.data) || (domains.isError && !domains.data);
  const visible = items && !expanded ? items.slice(0, MAX_VISIBLE) : items;
  const hiddenCount = items ? items.length - MAX_VISIBLE : 0;

  let body: ReactNode;
  if (loadFailed) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState
          compact
          title="Impossible de charger l’état des services"
          error={services.error ?? domains.error}
          onRetry={() => {
            void services.refetch();
            void domains.refetch();
          }}
        />
      </div>
    );
  } else if (!items || !visible) {
    body = (
      <ul aria-busy="true" aria-label="Chargement" className="divide-y">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <li key={index}>
            <RowSkeleton />
          </li>
        ))}
      </ul>
    );
  } else if (items.length === 0) {
    body = <HealthyState />;
  } else {
    body = (
      <>
        <ul className="relative divide-y">
          <AnimatePresence mode="popLayout" initial={false}>
            {visible.map((item) => (
              <motion.li
                key={item.id}
                layout
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={{ layout: SPRING.smooth }}
              >
                {item.kind === "service" ? (
                  <ServiceRow
                    service={item.service}
                    projectName={projectById.get(item.service.projectId)?.name}
                  />
                ) : (
                  <DomainRow
                    domain={item.domain}
                    projectName={projectById.get(item.domain.projectId)?.name}
                    serviceName={serviceById.get(item.domain.serviceId)?.name}
                  />
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {hiddenCount > 0 ? (
          <div className="mt-auto border-t p-2">
            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded
                ? "Réduire la liste"
                : hiddenCount > 1
                  ? `Afficher les ${hiddenCount} autres`
                  : "Afficher l’autre élément"}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <DashboardSection
      title="À surveiller"
      actions={
        items && items.length > 0 ? (
          <span className="tabular text-xs text-muted-foreground">
            {pluralize(items.length, "élément")}
          </span>
        ) : null
      }
      className={className}
    >
      <DashboardCard className="@container flex flex-1 flex-col overflow-hidden">
        <div aria-live="polite" className="flex flex-1 flex-col">
          {body}
        </div>
      </DashboardCard>
    </DashboardSection>
  );
}
