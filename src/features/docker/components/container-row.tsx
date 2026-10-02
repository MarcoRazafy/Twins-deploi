"use client";

import Link from "next/link";
import { RotateCw } from "lucide-react";
import { motion } from "motion/react";

import { ProgressBar } from "@/components/shared/progress-bar";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { EMPTY_VALUE, formatDuration, formatMegabytes, formatPercent } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import { routes } from "@/lib/routes";
import type { Container, ContainerAction, ProjectSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

import { formatPort, memoryPercent, usageTone } from "../lib/container-stats";
import { ContainerActions } from "./container-actions";

const MotionRow = motion.create(TableRow);

export interface ContainerRowProps {
  container: Container;
  project: ProjectSummary | undefined;
  serviceName: string | undefined;
  /** Epoch ms from `useNow`, 0 until the clock ticks. */
  now: number;
  busy: ContainerAction | undefined;
  onRun: (container: Container, action: ContainerAction) => void;
  onShowLogs: (container: Container) => void;
  onDelete: (container: Container) => void;
}

export function ContainerRow({
  container,
  project,
  serviceName,
  now,
  busy,
  onRun,
  onShowLogs,
  onDelete,
}: ContainerRowProps) {
  const memory = memoryPercent(container);
  const cpu = Math.min(100, container.cpuPercent);
  const running = container.state === "running";
  const uptime =
    running && container.startedAt && now > 0
      ? formatDuration(Math.max(0, now - Date.parse(container.startedAt)))
      : EMPTY_VALUE;

  return (
    <MotionRow
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
      transition={{ duration: DURATION.base, ease: EASE.out }}
    >
      <TableCell className="max-w-44 px-3!">
        <div className="truncate font-medium" title={container.name}>
          {container.name}
        </div>
        <div className="font-mono text-xs text-muted-foreground">{container.id.slice(0, 12)}</div>
        <div
          className="mt-1 truncate font-mono text-xs text-muted-foreground md:hidden"
          title={container.image}
        >
          {container.image}
        </div>
      </TableCell>

      <TableCell className="hidden max-w-40 px-3! md:table-cell">
        <div className="truncate font-mono text-[13px]" title={container.image}>
          {container.image}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {container.ports.length > 0 ? container.ports.map(formatPort).join(", ") : EMPTY_VALUE}
        </div>
      </TableCell>

      <TableCell className="hidden max-w-36 px-3! lg:table-cell">
        {project ? (
          <div className="flex min-w-0 items-center gap-2">
            <ProjectAvatar name={project.name} color={project.color} size="xs" />
            <div className="min-w-0">
              <div className="truncate text-sm">{project.name}</div>
              <Link
                href={routes.workspace(container.projectId, { service: container.serviceId })}
                className="block truncate text-xs text-brand-400 hover:underline"
              >
                {serviceName ?? container.name}
              </Link>
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">{EMPTY_VALUE}</span>
        )}
      </TableCell>

      <TableCell className="px-3!">
        <div className="flex flex-col items-start gap-1">
          <motion.div
            key={container.state}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: DURATION.base, ease: EASE.out }}
          >
            <StatusBadge kind="container" status={container.state} exitCode={container.exitCode} />
          </motion.div>
          {container.health !== "none" ? (
            <StatusBadge kind="health" status={container.health} size="sm" />
          ) : null}
        </div>
      </TableCell>

      <TableCell className="hidden px-3! lg:table-cell">
        <div className="w-16 space-y-1.5">
          <div className="tabular text-sm">{formatPercent(container.cpuPercent, 1)}</div>
          <ProgressBar value={cpu} size="sm" tone={usageTone(cpu)} label="Utilisation du processeur" />
        </div>
      </TableCell>

      <TableCell className="hidden px-3! lg:table-cell">
        <div className="w-28 space-y-1.5">
          <div className="tabular text-sm whitespace-nowrap">
            {formatMegabytes(container.memoryUsageMb)}
            <span className="text-muted-foreground"> / {formatMegabytes(container.memoryLimitMb)}</span>
          </div>
          <ProgressBar value={memory} size="sm" tone={usageTone(memory)} label="Utilisation de la mémoire" />
        </div>
      </TableCell>

      <TableCell className="hidden px-3! md:table-cell">
        <div className="tabular text-sm whitespace-nowrap">{uptime}</div>
        <div
          title={`${container.restartCount} redémarrage${container.restartCount > 1 ? "s" : ""}`}
          className={cn(
            "tabular mt-0.5 text-xs whitespace-nowrap transition-colors",
            container.restartCount > 0 ? "text-warning" : "text-muted-foreground",
          )}
        >
          <RotateCw aria-hidden className="mr-1 inline size-3" />
          {container.restartCount}
          <span className="sr-only"> redémarrage{container.restartCount > 1 ? "s" : ""}</span>
        </div>
      </TableCell>

      <TableCell className="px-3! text-right">
        <ContainerActions
          container={container}
          busy={busy}
          onRun={onRun}
          onShowLogs={onShowLogs}
          onDelete={onDelete}
        />
      </TableCell>
    </MotionRow>
  );
}

export function ContainerRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-1.5 h-3 w-24" />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-1.5 h-3 w-28" />
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-[5px]" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-20 rounded-full" />
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="mt-1.5 h-1 w-20" />
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-1.5 h-1 w-32" />
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="mt-1.5 h-3 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto h-7 w-24" />
      </TableCell>
    </TableRow>
  );
}
