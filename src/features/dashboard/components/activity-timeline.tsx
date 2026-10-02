"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Stagger, StaggerItem } from "@/components/shared/motion";
import { RelativeTime } from "@/components/shared/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActivityFilter } from "@/lib/api/contract";
import { useActivity } from "@/lib/queries";
import { ACTIVITY_SEVERITY, TONE_CLASSES } from "@/lib/status";
import type { ActivityEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

import { getActivityHref } from "../lib/activity-links";
import { DashboardCard, DashboardSection } from "./dashboard-section";

const ACTIVITY_FILTER: ActivityFilter = { limit: 10 };
const EVENT_COUNT = 10;

// Every row is exactly as tall (one line each for title, description and
// author), so the skeleton, the rail and the rows below never shift.
const ROW_LAYOUT = "-mx-2 flex gap-3 rounded-lg px-2 py-2";

/** Vertical rail from this row's icon to the next one. */
function Rail() {
  return (
    <span aria-hidden="true" className="absolute top-10 -bottom-2 left-4 w-px -translate-x-1/2 bg-border" />
  );
}

function TimelineRow({ event, last }: { event: ActivityEvent; last: boolean }) {
  const severity = ACTIVITY_SEVERITY[event.severity];
  const tone = TONE_CLASSES[severity.tone];
  const Icon = severity.icon;
  const href = getActivityHref(event);

  const content = (
    <>
      <span
        className={cn(
          "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border",
          tone.bg,
          tone.border,
          tone.text,
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-medium" title={event.title}>
            {event.title}
          </p>
          <RelativeTime date={event.createdAt} className="shrink-0 text-xs text-muted-foreground" />
        </div>
        <p className="truncate text-xs text-muted-foreground" title={event.description}>
          {event.description || " "}
        </p>
        <p className="truncate text-xs text-muted-foreground">{event.actor}</p>
      </div>
    </>
  );

  return (
    <StaggerItem as="li" className="relative">
      {last ? null : <Rail />}
      {href ? (
        <Link
          href={href}
          className={cn(
            ROW_LAYOUT,
            "outline-none transition-colors hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
        >
          {content}
        </Link>
      ) : (
        <div className={ROW_LAYOUT}>{content}</div>
      )}
    </StaggerItem>
  );
}

function TimelineSkeleton() {
  return (
    <ol aria-busy="true" aria-label="Chargement de l’activité">
      {Array.from({ length: EVENT_COUNT }, (_, index) => (
        <li key={index} className="relative">
          {index === EVENT_COUNT - 1 ? null : <Rail />}
          <div className={ROW_LAYOUT}>
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex h-5 items-center justify-between gap-3">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-14" />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className="h-3 w-4/5" />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface ActivityTimelineProps {
  className?: string;
}

/** The ten latest events of the platform as a vertical timeline, each one a link. */
export function ActivityTimeline({ className }: ActivityTimelineProps) {
  const query = useActivity(ACTIVITY_FILTER);
  const events = query.data;

  let body: ReactNode;
  if (query.isError && !events) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState
          compact
          title="Impossible de charger l’activité"
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </div>
    );
  } else if (!events) {
    body = <TimelineSkeleton />;
  } else if (events.length === 0) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          compact
          icon={Activity}
          title="Aucune activité"
          description="Les déploiements, redémarrages et modifications de vos projets apparaîtront ici."
        />
      </div>
    );
  } else {
    body = (
      <Stagger as="ol">
        {events.slice(0, EVENT_COUNT).map((event, index, shown) => (
          <TimelineRow key={event.id} event={event} last={index === shown.length - 1} />
        ))}
      </Stagger>
    );
  }

  return (
    <DashboardSection title="Activité récente" className={className}>
      <DashboardCard className="flex flex-1 flex-col p-4 sm:p-5">{body}</DashboardCard>
    </DashboardSection>
  );
}
