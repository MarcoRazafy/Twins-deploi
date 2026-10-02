"use client";

import { DeploymentList } from "@/features/deployments";
import type { DeploymentFilter } from "@/lib/api/contract";
import { routes } from "@/lib/routes";

import { DashboardSection, SectionLink } from "./dashboard-section";

const RECENT_FILTER: DeploymentFilter = { limit: 6 };

export interface RecentDeploymentsProps {
  className?: string;
}

/** The six latest deployments, as compact rows of the Déploiements page. */
export function RecentDeployments({ className }: RecentDeploymentsProps) {
  return (
    <DashboardSection
      title="Derniers déploiements"
      actions={<SectionLink href={routes.deployments()}>Voir tout</SectionLink>}
      className={className}
    >
      {/* Six rows measure about 390 px; the list skeleton has fewer rows, so
          the block reserves the room and the page below does not move. */}
      <div className="min-h-[390px]">
        <DeploymentList
          filter={RECENT_FILTER}
          compact
          emptyHint="Les déploiements de vos services apparaîtront ici."
        />
      </div>
    </DashboardSection>
  );
}
