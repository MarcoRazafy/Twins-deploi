"use client";

import { useMemo, useState } from "react";
import { CircleCheck, Hammer, Rocket, Timer } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/shared/page";
import { ProjectSelect } from "@/components/shared/project-select";
import { SearchInput } from "@/components/shared/search-input";
import { ServiceSelect } from "@/components/shared/service-select";
import { StatCard, type StatTone } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { useQueryParams } from "@/hooks/use-query-param";
import type { DeploymentFilter } from "@/lib/api/contract";
import { EMPTY_VALUE, formatDuration, formatPercent } from "@/lib/format";
import { usePlatformOverview } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { parseStatusFilter, STATUS_FILTERS } from "../lib/deployment-utils";
import { DeploymentList } from "./deployment-list";
import { StatusFilterChips } from "./status-filter-chips";

const formatRate = (value: number) => formatPercent(value, 0);

/** The "En cours" card pulses while something is building, like a status dot would. */
function PulsingHammer({ className }: { className?: string }) {
  return <Hammer className={cn(className, "animate-pulse")} />;
}

function rateTone(rate: number): StatTone {
  if (rate >= 90) return "success";
  if (rate >= 70) return "warning";
  return "danger";
}

/** Deployments page: platform figures, filters and the day-grouped history. */
export function DeploymentsView() {
  const params = useQueryParams();
  const project = params.get("project");
  const service = params.get("service");
  const status = parseStatusFilter(params.get("status"));
  const [search, setSearch] = useState("");

  const overview = usePlatformOverview();
  const stats = overview.data?.deployments;

  const filter = useMemo<DeploymentFilter>(
    () => ({
      projectId: project || undefined,
      serviceId: service || undefined,
      statuses: STATUS_FILTERS[status].statuses,
    }),
    [project, service, status],
  );
  const hasFilters = Boolean(project || service || status !== "all" || search.trim());

  return (
    <PageContainer>
      <PageHeader
        title="Déploiements"
        description="Historique des builds et des mises en production de tous vos services."
      />

      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Dernières 24 h"
          value={stats ? stats.last24h : EMPTY_VALUE}
          hint="déploiements lancés"
          icon={Rocket}
          tone="brand"
          loading={overview.isPending}
        />
        <StatCard
          label="Taux de réussite (7 j)"
          value={stats ? stats.successRate : EMPTY_VALUE}
          format={formatRate}
          hint="sur les 7 derniers jours"
          icon={CircleCheck}
          tone={stats ? rateTone(stats.successRate) : "neutral"}
          loading={overview.isPending}
        />
        <StatCard
          label="Durée moyenne"
          value={stats ? stats.avgDurationMs : EMPTY_VALUE}
          format={formatDuration}
          hint="build et déploiement"
          icon={Timer}
          loading={overview.isPending}
        />
        <StatCard
          label="En cours"
          value={stats ? stats.inProgress : EMPTY_VALUE}
          hint={stats && stats.inProgress > 0 ? "build ou déploiement actif" : "rien en cours"}
          icon={stats && stats.inProgress > 0 ? PulsingHammer : Hammer}
          tone="info"
          loading={overview.isPending}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Rechercher un commit, un service…"
            label="Rechercher un déploiement"
            shortcut="/"
            className="w-full sm:w-96"
          />
          <ProjectSelect
            allowAll
            value={project || null}
            // The service filter may belong to another project: start over on it.
            onChange={(next) => params.set({ project: next, service: null })}
            aria-label="Filtrer par projet"
            className="w-full sm:w-52"
          />
          <ServiceSelect
            allowAll
            projectId={project || null}
            value={service || null}
            onChange={(next) => params.set({ service: next })}
            aria-label="Filtrer par service"
            className="w-full sm:w-52"
          />
        </div>
        <StatusFilterChips
          value={status}
          onChange={(next) => params.set({ status: next === "all" ? null : next })}
        />
      </div>

      <DeploymentList
        grouped
        filter={filter}
        search={search}
        emptyHint={hasFilters ? "Aucun déploiement ne correspond à ces filtres." : undefined}
        emptyAction={
          hasFilters ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                params.set({ project: null, service: null, status: null });
                setSearch("");
              }}
            >
              Réinitialiser les filtres
            </Button>
          ) : undefined
        }
      />
    </PageContainer>
  );
}
