"use client";

import { useState, type ReactNode } from "react";
import { LayoutGroup, motion } from "motion/react";

import { Stagger, StaggerItem } from "@/components/shared/motion";
import { PageContainer } from "@/components/shared/page";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { CreateProjectDialog } from "@/features/projects";
import { useHydrated } from "@/hooks/use-hydrated";
import { SPRING } from "@/lib/motion";

import { ActivityTimeline } from "./activity-timeline";
import { AttentionList } from "./attention-list";
import { DashboardHeader } from "./dashboard-header";
import { DeploymentActivityChart } from "./deployment-activity-chart";
import { InFlightDeployments } from "./in-flight-deployments";
import { KpiRow } from "./kpi-row";
import { PlatformResources } from "./platform-resources";
import { ProjectsSection } from "./projects-section";
import { RecentDeployments } from "./recent-deployments";

/**
 * Entrance item that also slides to its new place when the in-flight strip
 * above it appears or disappears (`layout="position"` moves it, never
 * stretches it).
 */
function LayoutBlock({ children }: { children: ReactNode }) {
  return (
    <StaggerItem>
      <motion.div layout="position" transition={{ layout: SPRING.smooth }}>
        {children}
      </motion.div>
    </StaggerItem>
  );
}

/**
 * Two columns from 896 px of content (the container, not the screen: the
 * sidebar can be open or collapsed), the main one twice as wide. Cells are
 * placed explicitly so the DOM order is the phone order (what needs attention
 * first) while the desktop reads chart | watch list, then resources | activity,
 * with the activity timeline running along resources and deployments.
 */
function InsightsGrid() {
  return (
    <div className="grid gap-6 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <AttentionList className="@4xl:col-start-2 @4xl:row-start-1" />
      <DeploymentActivityChart className="@4xl:col-start-1 @4xl:row-start-1" />
      <PlatformResources className="@4xl:col-start-1 @4xl:row-start-2" />
      <RecentDeployments className="@4xl:col-start-1 @4xl:row-start-3" />
      <ActivityTimeline className="@4xl:col-start-2 @4xl:row-span-2 @4xl:row-start-2" />
    </div>
  );
}

/** Landing screen: health of every project, what is deploying, what needs attention. */
export function DashboardView() {
  const [createOpen, setCreateOpen] = useState(false);
  // The shell starts fetching before this page has hydrated, so cached data can
  // already exist during hydration and would differ from the server HTML.
  // Until hydration is done the page renders the same placeholder as the server.
  const hydrated = useHydrated();

  if (!hydrated) return <PageSkeleton />;

  return (
    <PageContainer>
      <LayoutGroup>
        <Stagger className="@container flex flex-col gap-6">
          <StaggerItem>
            <DashboardHeader onCreateProject={() => setCreateOpen(true)} />
          </StaggerItem>
          <StaggerItem>
            <KpiRow />
          </StaggerItem>
          <InFlightDeployments />
          <LayoutBlock>
            <ProjectsSection onCreateProject={() => setCreateOpen(true)} />
          </LayoutBlock>
          <LayoutBlock>
            <InsightsGrid />
          </LayoutBlock>
        </Stagger>
      </LayoutGroup>
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageContainer>
  );
}
