"use client";

import Link from "next/link";
import { ChevronRight, Download, Lock, Star } from "lucide-react";

import { RelativeTime } from "@/components/shared/relative-time";
import { StatusDot } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompactNumber, pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";
import { SERVICE_STATUS } from "@/lib/status";
import type { GithubRepo } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { GithubService } from "../lib/github-services";
import { languageDotClass } from "../lib/language";

const NO_SERVICES: readonly GithubService[] = [];

/** "owner/name" with the owner dimmed. */
function RepoFullName({ repo }: { repo: GithubRepo }) {
  return (
    <span className="min-w-0 truncate text-sm" title={repo.fullName}>
      <span className="text-muted-foreground">{repo.owner}/</span>
      <span className="font-medium text-foreground">{repo.name}</span>
    </span>
  );
}

function PrivateBadge() {
  return (
    <Badge variant="outline" className="shrink-0 text-muted-foreground">
      <Lock data-icon="inline-start" />
      Privé
    </Badge>
  );
}

/** Language, framework, stars and last push of a repository. */
export function RepoMeta({ repo, className }: { repo: GithubRepo; className?: string }) {
  const showFramework = repo.framework !== null && repo.framework !== repo.language;

  return (
    <span
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {repo.language !== null || showFramework ? (
        <span className="flex items-center gap-2">
          {repo.language !== null ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn("size-2.5 shrink-0 rounded-full", languageDotClass(repo.language))}
              />
              {repo.language}
            </span>
          ) : null}
          {showFramework ? <Badge variant="secondary">{repo.framework}</Badge> : null}
        </span>
      ) : null}
      <span className="flex items-center gap-3">
        <span className="tabular inline-flex items-center gap-1" title={pluralize(repo.stars, "étoile")}>
          <Star aria-hidden className="size-3.5" />
          {formatCompactNumber(repo.stars)}
        </span>
        <RelativeTime date={repo.pushedAt} prefix="Poussé" />
      </span>
    </span>
  );
}

/** Chips of the services already deployed from a repository. */
function DeployedServices({
  services,
  className,
}: {
  services: readonly GithubService[];
  className?: string;
}) {
  if (services.length === 0) return null;

  const MAX_CHIPS = 3;
  const visible = services.slice(0, MAX_CHIPS);
  const hidden = services.length - visible.length;

  return (
    <div
      role="group"
      aria-label="Services déployés depuis ce dépôt"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      <span className="text-xs text-muted-foreground">Déployé :</span>
      {visible.map((service) => {
        const status = SERVICE_STATUS[service.status];
        return (
          <Link
            key={service.id}
            href={routes.workspace(service.projectId, { service: service.id })}
            title={`${service.name} · ${status.label}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-secondary px-2 py-0.5 text-xs transition-colors outline-none hover:border-border-strong hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <StatusDot tone={status.tone} pulse={status.pulse} />
            <span className="truncate">{service.name}</span>
          </Link>
        );
      })}
      {hidden > 0 ? <span className="text-xs text-muted-foreground">+{hidden}</span> : null}
    </div>
  );
}

export interface RepoRowProps {
  repo: GithubRepo;
  /** Services already created from this repository. */
  services?: readonly GithubService[];
  onImport: (repo: GithubRepo) => void;
}

/**
 * Row of the repositories list. The layout follows the width of the list (a
 * container query), not the window: stacked when narrow, three columns when
 * the list is wide.
 */
export function RepoRow({ repo, services = NO_SERVICES, onImport }: RepoRowProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-accent/40 @2xl:grid-cols-[minmax(0,1fr)_15rem_auto]">
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
        <RepoFullName repo={repo} />
        {repo.private ? <PrivateBadge /> : null}
      </div>
      <p
        className="col-span-2 line-clamp-2 text-xs text-muted-foreground @2xl:col-span-1 @2xl:col-start-1 @2xl:row-start-2 @2xl:line-clamp-1"
        title={repo.description || undefined}
      >
        {repo.description || "Aucune description"}
      </p>
      <RepoMeta
        repo={repo}
        className="col-span-2 @2xl:col-span-1 @2xl:col-start-2 @2xl:row-span-3 @2xl:row-start-1 @2xl:flex-col @2xl:items-start @2xl:gap-1.5"
      />
      <DeployedServices
        services={services}
        className="col-span-2 @2xl:col-span-1 @2xl:col-start-1 @2xl:row-start-3"
      />
      <div className="col-start-2 row-start-1 @2xl:col-start-3 @2xl:row-span-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Importer ${repo.fullName}`}
          onClick={() => onImport(repo)}
        >
          <Download data-icon="inline-start" />
          Importer
        </Button>
      </div>
    </div>
  );
}

export interface RepoPickerRowProps {
  repo: GithubRepo;
  deployed: boolean;
  onSelect: (repo: GithubRepo) => void;
}

/** Compact row of the import dialog: the whole row picks the repository. */
export function RepoPickerRow({ repo, deployed, onSelect }: RepoPickerRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(repo)}
      className="group/row flex w-full items-center gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <RepoFullName repo={repo} />
          {repo.private ? <PrivateBadge /> : null}
          {deployed ? (
            <Badge variant="secondary" className="shrink-0">
              Déployé
            </Badge>
          ) : null}
        </span>
        <RepoMeta repo={repo} />
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/row:translate-x-0.5"
      />
    </button>
  );
}

/** Same geometry as `RepoRow`, so the list does not jump when data arrives. */
export function RepoRowSkeleton() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 @2xl:grid-cols-[minmax(0,1fr)_15rem_auto]"
    >
      <Skeleton className="col-start-1 row-start-1 h-4 w-48 max-w-full" />
      <Skeleton className="col-span-2 h-3 w-72 max-w-full @2xl:col-span-1" />
      <Skeleton className="col-span-2 h-3 w-56 max-w-full @2xl:col-span-1 @2xl:col-start-2 @2xl:row-span-2 @2xl:row-start-1" />
      <Skeleton className="col-start-2 row-start-1 h-7 w-24 rounded-lg @2xl:col-start-3 @2xl:row-span-2" />
    </div>
  );
}

export function RepoPickerRowSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2 px-4 py-3">
      <Skeleton className="h-4 w-52 max-w-full" />
      <Skeleton className="h-3 w-64 max-w-full" />
    </div>
  );
}
