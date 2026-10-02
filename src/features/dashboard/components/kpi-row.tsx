"use client";

import { FolderKanban, Globe, Rocket, Server } from "lucide-react";

import { ErrorState } from "@/components/shared/error-state";
import { StatCard } from "@/components/shared/stat-card";
import { formatNumber, formatPercent, pluralize } from "@/lib/format";
import { usePlatformOverview, useProjects } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";

import { successRateTone, summarizeDomains, summarizeServices } from "../lib/health";

// One column on a phone: two would cut the labels ("Déploiements sur 24 h")
// down to a few letters. Four columns need roughly 960 px of content.
const KPI_GRID = "grid grid-cols-1 gap-4 @[448px]:grid-cols-2 @[960px]:grid-cols-4";

/** Four headline numbers of the platform, each a link to the page behind it. */
export function KpiRow() {
  const overview = usePlatformOverview();
  const projects = useProjects();
  const data = overview.data;

  if (overview.isError && !data) {
    return (
      <div className="flex min-h-[130px] items-center justify-center rounded-xl border bg-card sm:min-h-[138px]">
        <ErrorState
          compact
          title="Impossible de charger les indicateurs"
          error={overview.error}
          onRetry={() => {
            void overview.refetch();
          }}
        />
      </div>
    );
  }

  const projectCount = projects.data?.length ?? data?.projects;
  const servicesHealth = data ? summarizeServices(data.services) : null;
  const domainsHealth = data ? summarizeDomains(data.domains) : null;
  const servicesTotal = data?.services.total ?? 0;
  const dailyTotals = data?.deploymentsPerDay.map((day) => day.succeeded + day.failed) ?? [];
  const hasDeployments = (data?.deployments.last24h ?? 0) > 0 || dailyTotals.some((count) => count > 0);
  const successRate = data?.deployments.successRate ?? 0;

  return (
    <div className={KPI_GRID}>
      <StatCard
        label="Projets"
        value={projectCount ?? 0}
        loading={projectCount === undefined}
        icon={FolderKanban}
        tone="brand"
        hint={data ? `${pluralize(data.services.total, "service")} au total` : undefined}
        href={routes.projects()}
      />
      <StatCard
        label="Services en ligne"
        value={data?.services.online ?? 0}
        format={(value) => `${formatNumber(Math.round(value))} / ${formatNumber(servicesTotal)}`}
        loading={!data}
        icon={Server}
        tone={servicesHealth?.tone ?? "neutral"}
        hint={servicesHealth?.hint}
        href={routes.docker()}
      />
      <StatCard
        label="Déploiements sur 24 h"
        value={data?.deployments.last24h ?? 0}
        loading={!data}
        icon={Rocket}
        tone="info"
        sparkline={dailyTotals}
        hint={
          hasDeployments ? (
            <>
              Réussite 7 j :{" "}
              <span className={cn("font-medium", TONE_CLASSES[successRateTone(successRate)].text)}>
                {formatPercent(successRate, 0)}
              </span>
            </>
          ) : (
            "Aucun déploiement récent"
          )
        }
        href={routes.deployments()}
      />
      <StatCard
        label="Domaines actifs"
        value={data?.domains.active ?? 0}
        loading={!data}
        icon={Globe}
        tone={domainsHealth?.tone ?? "neutral"}
        hint={domainsHealth?.hint}
        href={routes.domains()}
      />
    </div>
  );
}
