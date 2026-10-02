"use client";

import { Container as ContainerIcon, Play } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LogViewer } from "@/components/shared/log-viewer";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useContainerLogs, useContainers } from "@/lib/queries";
import type { Container } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useContainerControls } from "../hooks/use-container-controls";
import { canStart } from "../lib/container-stats";

export interface ServiceRuntimeLogsProps {
  serviceId: string;
  className?: string;
  /** Fills the height of the parent (flex column) instead of the default 420 px. */
  fill?: boolean;
}

/** Live runtime logs of the container backing a service. */
export function ServiceRuntimeLogs({ serviceId, className, fill }: ServiceRuntimeLogsProps) {
  const containers = useContainers();
  const container = containers.data?.find((item) => item.serviceId === serviceId);
  const frame = cn(fill && "h-full", className);

  if (containers.isError && !containers.data) {
    return (
      <div className={frame}>
        <ErrorState
          compact
          title="Impossible de charger le conteneur"
          error={containers.error}
          onRetry={() => {
            void containers.refetch();
          }}
        />
      </div>
    );
  }
  if (!container) {
    if (containers.isPending) {
      return (
        <div className={frame}>
          <LogViewer lines={[]} loading height={fill ? "100%" : 420} className={fill ? "h-full" : undefined} />
        </div>
      );
    }
    return (
      <div className={frame}>
        <EmptyState
          compact
          icon={ContainerIcon}
          title="Aucun conteneur"
          description="Ce service n’a pas encore de conteneur. Lancez un déploiement pour en créer un."
        />
      </div>
    );
  }

  return <ContainerLogsPanel container={container} fill={fill} className={className} />;
}

function ContainerLogsPanel({
  container,
  fill,
  className,
}: {
  container: Container;
  fill?: boolean;
  className?: string;
}) {
  const logs = useContainerLogs(container.id);
  const { pending, run } = useContainerControls();
  const busy = pending[container.id];
  const stopped = container.state !== "running";

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", fill && "h-full", className)}>
      {stopped ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-secondary px-3 py-2.5 text-sm"
        >
          <StatusBadge kind="container" status={container.state} exitCode={container.exitCode} />
          <span className="min-w-0 flex-1 text-muted-foreground">
            {container.state === "restarting"
              ? "Le conteneur redémarre : les logs reprendront dans un instant."
              : "Le conteneur n’est pas en cours d’exécution. Voici ses dernières lignes."}
          </span>
          {canStart(container.state) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy !== undefined}
              onClick={() => void run(container, "start")}
            >
              {busy === "start" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              Démarrer
            </Button>
          ) : null}
        </div>
      ) : null}
      {logs.error ? (
        <ErrorState compact title="Impossible de charger les logs" error={logs.error} />
      ) : (
        <LogViewer
          lines={logs.lines}
          streaming={logs.isStreaming}
          loading={logs.isLoading}
          title={container.name}
          downloadName={container.name}
          emptyMessage="Ce conteneur n’a produit aucun log pour le moment"
          height={fill ? "100%" : 420}
          className={fill ? "min-h-0 flex-1" : undefined}
        />
      )}
    </div>
  );
}
