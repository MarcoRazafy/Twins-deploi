"use client";

import { useState, type ReactNode } from "react";
import { CalendarClock, Clock, Globe, Plus, Search, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Stagger, StaggerItem } from "@/components/shared/motion";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { ProjectSelect } from "@/components/shared/project-select";
import { SearchInput } from "@/components/shared/search-input";
import { ServiceSelect } from "@/components/shared/service-select";
import { StatCard } from "@/components/shared/stat-card";
import { StatusDot } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated } from "@/hooks/use-hydrated";
import { useNow } from "@/hooks/use-now";
import { useQueryParams } from "@/hooks/use-query-param";
import { EMPTY_VALUE, pluralize } from "@/lib/format";
import { useDomains, useProjects, useServices } from "@/lib/queries";
import { DOMAIN_STATUS } from "@/lib/status";
import type { Domain } from "@/lib/types";

import { useDomainActions } from "../hooks/use-domain-actions";
import {
  computeDomainStats,
  DOMAIN_STATUSES,
  parseStatusFilter,
  SSL_WARNING_DAYS,
} from "../lib/domain-utils";
import { AddDomainDialog } from "./add-domain-dialog";
import { DomainDetailSheet } from "./domain-detail-sheet";
import { DomainsTable, DomainsTableSkeleton } from "./domains-table";

/** Radix Select forbids an empty item value, so "all" travels under a sentinel. */
const ALL_STATUSES = "__all__";

interface DomainsStatsProps {
  domains: Domain[];
  now: number;
  loading: boolean;
}

function DomainsStats({ domains, now, loading }: DomainsStatsProps) {
  const stats = computeDomainStats(domains, now);
  const clockLoading = loading || now === 0;

  return (
    <Stagger className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      <StaggerItem className="h-full">
        <StatCard
          label="Domaines actifs"
          value={loading ? EMPTY_VALUE : stats.active}
          hint={loading ? undefined : `sur ${pluralize(stats.total, "domaine")}`}
          icon={Globe}
          tone="success"
          loading={loading}
          className="h-full"
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          label="En attente de DNS"
          value={loading ? EMPTY_VALUE : stats.pendingDns}
          hint={
            loading
              ? undefined
              : stats.inProgress > 0
                ? `${pluralize(stats.inProgress, "vérification")} en cours`
                : "à configurer chez votre registrar"
          }
          icon={Clock}
          tone={stats.pendingDns > 0 ? "warning" : "neutral"}
          loading={loading}
          className="h-full"
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          label="Certificats SSL valides"
          value={loading ? EMPTY_VALUE : stats.validCertificates}
          hint={loading ? undefined : "renouvelés automatiquement"}
          icon={ShieldCheck}
          tone="brand"
          loading={loading}
          className="h-full"
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          label={`Expirent sous ${SSL_WARNING_DAYS} jours`}
          value={clockLoading ? EMPTY_VALUE : stats.expiringSoon}
          hint={
            clockLoading
              ? undefined
              : stats.expiringSoon > 0
                ? "à surveiller"
                : "aucun certificat concerné"
          }
          icon={CalendarClock}
          tone={stats.expiringSoon > 0 ? "warning" : "neutral"}
          loading={clockLoading}
          className="h-full"
        />
      </StaggerItem>
    </Stagger>
  );
}

/** Domains page: figures, filters, the table and the detail sheet of the selected domain. */
export function DomainsView() {
  const params = useQueryParams();
  const project = params.get("project") || null;
  const service = params.get("service") || null;
  const status = parseStatusFilter(params.get("status"));
  const creating = params.get("new") === "1";

  const [search, setSearch] = useState("");
  // The selected domain is kept whole so the sheet still has content while it slides out.
  const [selected, setSelected] = useState<Domain | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Control that had the focus when the sheet opened, to hand it back when the sheet closes.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const now = useNow(30_000);
  const hydrated = useHydrated();

  const domainsQuery = useDomains({
    projectId: project ?? undefined,
    serviceId: service ?? undefined,
  });
  const servicesQuery = useServices();
  const projectsQuery = useProjects();

  const actions = useDomainActions({
    onDeleted: (domain) => {
      if (selected?.id === domain.id) setSheetOpen(false);
    },
  });

  const domains = domainsQuery.data ?? [];
  const servicesById = new Map((servicesQuery.data ?? []).map((item) => [item.id, item] as const));
  const projectsById = new Map((projectsQuery.data ?? []).map((item) => [item.id, item] as const));

  const needle = search.trim().toLowerCase();
  const visible = domains.filter((domain) => {
    if (status && domain.status !== status) return false;
    if (!needle) return true;
    const haystack = [
      domain.hostname,
      servicesById.get(domain.serviceId)?.name,
      projectsById.get(domain.projectId)?.name,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
  const hasFilters = Boolean(project || service || status || needle);
  const liveSelected = selected
    ? (domains.find((domain) => domain.id === selected.id) ?? selected)
    : null;

  function openDialog() {
    params.set({ new: "1" });
  }

  function resetFilters() {
    params.set({ project: null, service: null, status: null });
    setSearch("");
  }

  function selectDomain(domain: Domain) {
    // A menu item vanishes with its menu: only a control that stays on the page can take the focus back.
    const active = document.activeElement;
    setOpener(active instanceof HTMLElement && active.getAttribute("role") !== "menuitem" ? active : null);
    setSelected(domain);
    setSheetOpen(true);
  }

  const toolbar = (
    <>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Rechercher un domaine, un service…"
        label="Rechercher un domaine"
        shortcut="/"
        className="w-full sm:w-72"
      />
      {/*
        The shared selects read projects the shell may have cached before this page
        hydrates, while the server HTML holds their skeleton: wait for hydration.
      */}
      {hydrated ? (
        <ProjectSelect
          allowAll
          value={project}
          // The service filter may belong to another project: start over on it.
          onChange={(next) => params.set({ project: next, service: null })}
          aria-label="Filtrer par projet"
          className="w-full sm:w-44"
        />
      ) : (
        <Skeleton aria-busy="true" className="h-8 w-full rounded-lg sm:w-44" />
      )}
      {hydrated ? (
        <ServiceSelect
          allowAll
          projectId={project}
          value={service}
          onChange={(next) => params.set({ service: next })}
          aria-label="Filtrer par service"
          className="w-full sm:w-44"
        />
      ) : (
        <Skeleton aria-busy="true" className="h-8 w-full rounded-lg sm:w-44" />
      )}
      <Select
        value={status ?? ALL_STATUSES}
        onValueChange={(next) => params.set({ status: next === ALL_STATUSES ? null : next })}
      >
        <SelectTrigger aria-label="Filtrer par statut" className="w-full sm:w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_STATUSES}>Tous les statuts</SelectItem>
          {DOMAIN_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>
              <StatusDot tone={DOMAIN_STATUS[value].tone} pulse={DOMAIN_STATUS[value].pulse} />
              {DOMAIN_STATUS[value].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  let content: ReactNode;
  if (domainsQuery.isError) {
    content = (
      <ErrorState
        title="Impossible de charger les domaines"
        error={domainsQuery.error}
        onRetry={() => {
          void domainsQuery.refetch();
        }}
      />
    );
  } else if (domainsQuery.isPending) {
    content = <DomainsTableSkeleton toolbar={toolbar} />;
  } else if (domains.length === 0 && !hasFilters) {
    content = (
      <EmptyState
        icon={Globe}
        title="Aucun domaine"
        description="Générez un domaine en un clic ou reliez votre propre nom de domaine à un service."
        action={
          <Button type="button" variant="secondary" onClick={openDialog}>
            <Plus data-icon="inline-start" />
            Ajouter un domaine
          </Button>
        }
      />
    );
  } else {
    content = (
      <DomainsTable
        domains={visible}
        total={domains.length}
        services={servicesById}
        projects={projectsById}
        lookupsLoading={servicesQuery.isPending || projectsQuery.isPending}
        now={now}
        toolbar={toolbar}
        dimmed={domainsQuery.isPlaceholderData}
        actions={actions}
        onSelect={selectDomain}
        empty={
          <EmptyState
            compact
            icon={Search}
            title="Aucun domaine ne correspond"
            description="Modifiez la recherche ou les filtres pour élargir la liste."
            action={
              hasFilters ? (
                <Button type="button" variant="outline" onClick={resetFilters}>
                  Réinitialiser les filtres
                </Button>
              ) : undefined
            }
          />
        }
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Domaines"
        description="Exposez vos services sur Internet avec un domaine généré ou votre propre nom de domaine, certificat SSL inclus."
        actions={
          <Button type="button" onClick={openDialog}>
            <Plus data-icon="inline-start" />
            Ajouter un domaine
          </Button>
        }
      />

      <DomainsStats
        domains={domains}
        now={now}
        loading={domainsQuery.isPending || domainsQuery.isError}
      />

      {content}

      <DomainDetailSheet
        domain={liveSelected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        actions={actions}
        onCloseAutoFocus={(event) => {
          if (opener?.isConnected) {
            event.preventDefault();
            opener.focus();
          }
        }}
      />
      <AddDomainDialog
        open={creating}
        onOpenChange={(open) => params.set({ new: open ? "1" : null })}
        defaultServiceId={service ?? undefined}
      />
      {actions.dialogs}
    </PageContainer>
  );
}
