"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { GitBranch } from "lucide-react";

import { CopyButton } from "@/components/shared/copy-button";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { SectionCard } from "@/components/shared/section-card";
import { ServiceIcon } from "@/components/shared/service-icon";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, shortSha } from "@/lib/format";
import { routes } from "@/lib/routes";
import { DEPLOYMENT_TRIGGER_LABELS } from "@/lib/status";
import type { Deployment, Project, Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DeploymentDuration } from "./deployment-duration";

const LINK_CLASSES =
  "inline-flex max-w-full items-center gap-2 rounded-md font-medium outline-none transition-colors hover:text-brand-400 focus-visible:ring-3 focus-visible:ring-ring/50";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export interface DeploymentSummaryProps {
  deployment: Deployment;
  service: Service | undefined;
  project: Project | undefined;
  /** The service and project are still loading. */
  loadingRefs: boolean;
}

export function DeploymentSummary({
  deployment,
  service,
  project,
  loadingRefs,
}: DeploymentSummaryProps) {
  const { commit, image } = deployment;

  return (
    <SectionCard title="Résumé">
      <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {commit ? (
          <Field label="Commit" className="sm:col-span-2 lg:col-span-3">
            <p className="font-medium break-words">{commit.message}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <code
                  title={commit.sha}
                  className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[13px] text-foreground"
                >
                  {shortSha(commit.sha)}
                </code>
                <CopyButton value={commit.sha} tooltip="Copier le SHA" />
              </span>
              <span>par {commit.author}</span>
              <Badge
                variant="outline"
                className="max-w-48 gap-1 px-1.5 font-mono text-[11px] font-normal text-muted-foreground"
              >
                <GitBranch aria-hidden="true" />
                <span className="min-w-0 truncate">{commit.branch}</span>
              </Badge>
            </div>
          </Field>
        ) : null}

        {image ? (
          <Field label="Image" className="sm:col-span-2 lg:col-span-3">
            <span className="inline-flex max-w-full items-center gap-1">
              <code title={image} className="min-w-0 truncate font-mono text-[13px]">
                {image}
              </code>
              <CopyButton value={image} tooltip="Copier la référence de l’image" />
            </span>
          </Field>
        ) : null}

        <Field label="Service">
          {loadingRefs ? (
            <Skeleton className="h-5 w-32" />
          ) : service ? (
            <Link
              href={routes.workspace(deployment.projectId, { service: service.id })}
              className={LINK_CLASSES}
            >
              <ServiceIcon type={service.source.type} />
              <span className="truncate">{service.name}</span>
            </Link>
          ) : (
            <span className="text-muted-foreground">Service supprimé</span>
          )}
        </Field>

        <Field label="Projet">
          {loadingRefs ? (
            <Skeleton className="h-5 w-32" />
          ) : project ? (
            <Link href={routes.workspace(project.id)} className={LINK_CLASSES}>
              <ProjectAvatar name={project.name} color={project.color} size="xs" />
              <span className="truncate">{project.name}</span>
            </Link>
          ) : (
            <span className="text-muted-foreground">Projet supprimé</span>
          )}
        </Field>

        <Field label="Déclencheur">{DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]}</Field>

        <Field label="Créé par">
          <span className="inline-flex max-w-full items-center gap-2">
            <UserAvatar name={deployment.creator} size="sm" />
            <span className="truncate">{deployment.creator}</span>
          </span>
        </Field>

        <Field label={deployment.startedAt ? "Démarré le" : "Créé le"}>
          <time dateTime={deployment.startedAt ?? deployment.createdAt}>
            {formatDateTime(deployment.startedAt ?? deployment.createdAt)}
          </time>
        </Field>

        <Field label="Durée">
          <DeploymentDuration deployment={deployment} />
        </Field>
      </dl>
    </SectionCard>
  );
}
