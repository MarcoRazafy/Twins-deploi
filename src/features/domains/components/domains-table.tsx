"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Ellipsis, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { motion } from "motion/react";

import { Stagger } from "@/components/shared/motion";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { RelativeTime } from "@/components/shared/relative-time";
import { ServiceIcon } from "@/components/shared/service-icon";
import { TableShell } from "@/components/shared/table-shell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pluralize } from "@/lib/format";
import { staggerItem } from "@/lib/motion";
import { routes } from "@/lib/routes";
import type { Domain, ProjectSummary, Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { DomainActions } from "../hooks/use-domain-actions";
import { isVerificationRunning } from "../lib/domain-utils";
import {
  DomainKindBadge,
  DomainQuickActions,
  DomainSslCell,
  DomainStatusBadge,
} from "./domain-parts";

/*
 * Columns appear with the width of the table itself (container queries), not
 * the window: the sidebar takes a variable share of it. Below `@xl` the status
 * and the service move under the hostname.
 */
const HEAD = "px-2!";
const CELL = "px-2!";
/** Hostname column: it takes the width the others leave, and its text truncates. */
const FIRST = "w-full max-w-0 pr-2! pl-3!";
const COLUMN = {
  kind: "hidden @5xl:table-cell",
  service: "hidden @xl:table-cell",
  status: "hidden @xl:table-cell",
  ssl: "hidden @4xl:table-cell",
  port: "hidden @5xl:table-cell",
  created: "hidden @5xl:table-cell",
} as const;

function TableColumns() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead className={FIRST}>Domaine</TableHead>
        <TableHead className={cn(HEAD, COLUMN.kind)}>Type</TableHead>
        <TableHead className={cn(HEAD, COLUMN.service)}>Service</TableHead>
        <TableHead className={cn(HEAD, COLUMN.status)}>Statut</TableHead>
        <TableHead className={cn(HEAD, COLUMN.ssl)}>SSL</TableHead>
        <TableHead className={cn(HEAD, COLUMN.port)}>Port</TableHead>
        <TableHead className={cn(HEAD, COLUMN.created)}>Créé</TableHead>
        <TableHead className={cn(HEAD, "w-12")}>
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function RowActions({
  domain,
  actions,
  onConfigure,
}: {
  domain: Domain;
  actions: DomainActions;
  onConfigure: (domain: Domain) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Actions pour ${domain.hostname}`}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        {domain.status !== "active" ? (
          <DropdownMenuItem
            disabled={isVerificationRunning(domain.status)}
            onSelect={() => actions.verify(domain)}
          >
            <RefreshCw />
            Vérifier le DNS
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => onConfigure(domain)}>
          <Settings2 />
          Configurer
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => actions.requestDelete(domain)}>
          <Trash2 />
          Supprimer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ServiceCellProps {
  service: Service | undefined;
  project: ProjectSummary | undefined;
  loading: boolean;
}

function ServiceCell({ service, project, loading }: ServiceCellProps) {
  if (!service) {
    return loading ? (
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
    ) : (
      <span className="text-sm text-muted-foreground">Service supprimé</span>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Link
        href={routes.workspace(service.projectId, { service: service.id })}
        onClick={(event) => event.stopPropagation()}
        className="inline-flex max-w-44 items-center gap-1.5 rounded-sm text-sm font-medium outline-none hover:text-brand-400 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ServiceIcon type={service.source.type} className="shrink-0" />
        <span className="truncate">{service.name}</span>
      </Link>
      {project ? (
        <span className="inline-flex max-w-44 items-center gap-1.5 text-xs text-muted-foreground">
          <ProjectAvatar name={project.name} color={project.color} size="xs" />
          <span className="truncate">{project.name}</span>
        </span>
      ) : null}
    </div>
  );
}

interface DomainRowProps {
  domain: Domain;
  service: Service | undefined;
  project: ProjectSummary | undefined;
  lookupsLoading: boolean;
  now: number;
  actions: DomainActions;
  onSelect: (domain: Domain) => void;
}

function DomainRow({ domain, service, project, lookupsLoading, now, actions, onSelect }: DomainRowProps) {
  return (
    <motion.tr
      variants={staggerItem}
      onClick={() => onSelect(domain)}
      className="cursor-pointer border-b transition-colors hover:bg-accent/40"
    >
      <TableCell className={FIRST}>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-0.5">
            {/* The row is clickable for the mouse; this button is its keyboard entry. */}
            <button
              type="button"
              title={domain.hostname}
              className="min-w-0 truncate rounded-sm text-left font-mono text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {domain.hostname}
            </button>
            <DomainQuickActions hostname={domain.hostname} />
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground @xl:hidden">
            <DomainStatusBadge status={domain.status} size="sm" />
            <span className="truncate">{service?.name}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, COLUMN.kind)}>
        <DomainKindBadge kind={domain.kind} />
      </TableCell>
      <TableCell className={cn(CELL, COLUMN.service)}>
        <ServiceCell service={service} project={project} loading={lookupsLoading} />
      </TableCell>
      <TableCell className={cn(CELL, COLUMN.status)}>
        <DomainStatusBadge status={domain.status} />
      </TableCell>
      <TableCell className={cn(CELL, COLUMN.ssl)}>
        <DomainSslCell domain={domain} now={now} />
      </TableCell>
      <TableCell className={cn(CELL, COLUMN.port)}>
        <span className="tabular font-mono text-[13px]">{domain.targetPort}</span>
      </TableCell>
      <TableCell className={cn(CELL, COLUMN.created)}>
        <RelativeTime date={domain.createdAt} className="text-sm text-muted-foreground" />
      </TableCell>
      {/* Menu events (also those of its portal) must not open the detail sheet. */}
      <TableCell className="w-12 px-2!" onClick={(event) => event.stopPropagation()}>
        <RowActions domain={domain} actions={actions} onConfigure={onSelect} />
      </TableCell>
    </motion.tr>
  );
}

export interface DomainsTableProps {
  /** The rows to show (already filtered). */
  domains: Domain[];
  /** How many domains exist before the search and status filters. */
  total: number;
  services: ReadonlyMap<string, Service>;
  projects: ReadonlyMap<string, ProjectSummary>;
  lookupsLoading: boolean;
  now: number;
  toolbar: ReactNode;
  /** Shown instead of the rows when `domains` is empty. */
  empty: ReactNode;
  /** Dims the rows while a new filter is loading. */
  dimmed?: boolean;
  actions: DomainActions;
  onSelect: (domain: Domain) => void;
}

export function DomainsTable({
  domains,
  total,
  services,
  projects,
  lookupsLoading,
  now,
  toolbar,
  empty,
  dimmed = false,
  actions,
  onSelect,
}: DomainsTableProps) {
  return (
    <TableShell
      toolbar={toolbar}
      className="@container"
      footer={
        <span>
          {pluralize(domains.length, "domaine")}
          {domains.length !== total ? ` sur ${total}` : null}
        </span>
      }
    >
      {domains.length === 0 ? (
        empty
      ) : (
        <div className={cn("transition-opacity", dimmed && "opacity-60")} aria-busy={dimmed}>
          <Table>
            <TableColumns />
            <Stagger as="tbody" className="[&_tr:last-child]:border-0">
              {domains.map((domain) => (
                <DomainRow
                  key={domain.id}
                  domain={domain}
                  service={services.get(domain.serviceId)}
                  project={projects.get(domain.projectId)}
                  lookupsLoading={lookupsLoading}
                  now={now}
                  actions={actions}
                  onSelect={onSelect}
                />
              ))}
            </Stagger>
          </Table>
        </div>
      )}
    </TableShell>
  );
}

const SKELETON_ROWS = 5;

/** Same columns and row height as the table, so nothing jumps when the data arrives. */
export function DomainsTableSkeleton({ toolbar }: { toolbar: ReactNode }) {
  return (
    <TableShell toolbar={toolbar} className="@container">
      <div aria-busy="true">
        <Table>
          <TableColumns />
          <TableBody>
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <TableRow key={index} className="hover:bg-transparent">
                <TableCell className={FIRST}>
                  <Skeleton className="h-4 w-56 max-w-full" />
                  <Skeleton className="mt-2 h-4 w-32 @xl:hidden" />
                </TableCell>
                <TableCell className={cn(CELL, COLUMN.kind)}>
                  <Skeleton className="h-5 w-24 rounded-full" />
                </TableCell>
                <TableCell className={cn(CELL, COLUMN.service)}>
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="mt-1.5 h-3 w-20" />
                </TableCell>
                <TableCell className={cn(CELL, COLUMN.status)}>
                  <Skeleton className="h-6 w-24 rounded-full" />
                </TableCell>
                <TableCell className={cn(CELL, COLUMN.ssl)}>
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="mt-1 h-3 w-24" />
                </TableCell>
                <TableCell className={cn(CELL, COLUMN.port)}>
                  <Skeleton className="h-4 w-10" />
                </TableCell>
                <TableCell className={cn(CELL, COLUMN.created)}>
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell className="w-12 px-2!">
                  <Skeleton className="size-8 rounded-lg" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </TableShell>
  );
}
