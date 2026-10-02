"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Bell, BellOff, CheckCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { RelativeTime } from "@/components/shared/relative-time";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ActivityFilter } from "@/lib/api/contract";
import { useActivity, useMarkActivityRead, useUnreadActivityCount } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { ACTIVITY_SEVERITY, TONE_CLASSES } from "@/lib/status";
import type { ActivityEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const LATEST_COUNT = 20;
const LATEST_FILTER: ActivityFilter = { limit: LATEST_COUNT };

/** The most relevant screen for an event, or null when there is nothing to open. */
function getEventHref(event: ActivityEvent): string | null {
  if (event.type === "project.deleted") return null;
  if (event.deploymentId) return routes.deployment(event.deploymentId);
  if (event.projectId && event.serviceId && event.type !== "service.deleted") {
    return routes.workspace(event.projectId, { service: event.serviceId });
  }
  if (event.projectId) return routes.workspace(event.projectId);
  return null;
}

const ROW_CLASS =
  "relative flex w-full items-start gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50";

function NotificationItem({
  event,
  onOpen,
}: {
  event: ActivityEvent;
  onOpen: (event: ActivityEvent) => void;
}) {
  const severity = ACTIVITY_SEVERITY[event.severity];
  const tone = TONE_CLASSES[severity.tone];
  const { icon: Icon } = severity;
  const href = getEventHref(event);

  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
          tone.bg,
          tone.border,
          tone.text,
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm",
            event.read ? "text-muted-foreground" : "font-medium text-foreground",
          )}
        >
          {event.title}
        </span>
        {event.description ? (
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {event.description}
          </span>
        ) : null}
        <RelativeTime date={event.createdAt} className="mt-1 block text-xs text-muted-foreground" />
      </span>
      {event.read ? null : (
        <span className="mt-2 flex shrink-0 items-center" role="img" aria-label="Non lue">
          <span className="size-2 rounded-full bg-brand-500" />
        </span>
      )}
    </>
  );

  return href ? (
    <Link href={href} onClick={() => onOpen(event)} className={ROW_CLASS}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={() => onOpen(event)} className={ROW_CLASS}>
      {content}
    </button>
  );
}

function NotificationsSkeleton() {
  return (
    <div aria-busy="true" className="divide-y divide-border">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-start gap-3 px-3 py-2.5">
          <Skeleton className="mt-0.5 size-7 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function NotificationsPopover() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadActivityCount();
  const activity = useActivity(LATEST_FILTER);
  const markRead = useMarkActivityRead();

  const events = activity.data?.slice(0, LATEST_COUNT);

  const openEvent = (event: ActivityEvent) => {
    if (!event.read) markRead.mutate([event.id]);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label={unread > 0 ? `Notifications, ${unread} non lues` : "Notifications"}
            >
              <Bell />
              {unread > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular ring-2 ring-background"
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Notifications</TooltipContent>
      </Tooltip>

      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-[min(24rem,calc(100vw-1.5rem))] gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          <Button
            variant="ghost"
            size="xs"
            disabled={unread === 0 || markRead.isPending}
            onClick={() => markRead.mutate("all")}
          >
            <CheckCheck data-icon="inline-start" />
            Tout marquer comme lu
          </Button>
        </div>

        <div className="max-h-[min(26rem,calc(100dvh-10rem))] overflow-y-auto overscroll-contain">
          {activity.isPending ? (
            <NotificationsSkeleton />
          ) : activity.isError ? (
            <ErrorState
              compact
              title="Notifications indisponibles"
              error={activity.error}
              onRetry={() => void activity.refetch()}
            />
          ) : events && events.length > 0 ? (
            <ul className="divide-y divide-border">
              {events.map((event) => (
                <li key={event.id}>
                  <NotificationItem event={event} onOpen={openEvent} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={BellOff}
              title="Aucune notification"
              description="Les événements de la plateforme apparaîtront ici."
            />
          )}
        </div>

        <div className="border-t p-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="w-full justify-between text-muted-foreground hover:text-foreground"
          >
            <Link href={routes.deployments()} onClick={() => setOpen(false)}>
              Voir tous les déploiements
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
