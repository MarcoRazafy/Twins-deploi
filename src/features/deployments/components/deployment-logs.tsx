"use client";

import { Clock } from "lucide-react";

import { ErrorState } from "@/components/shared/error-state";
import { LogViewer } from "@/components/shared/log-viewer";
import { useDeployment, useDeploymentLogs } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { shortDeploymentId } from "../lib/deployment-utils";

function QueuedPlaceholder() {
  return (
    <div
      role="status"
      className="flex size-full flex-col items-center justify-center gap-3 rounded-xl border bg-card p-6 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-xl border border-info/25 bg-info/10 text-info">
        <Clock aria-hidden="true" className="size-5 animate-pulse" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">En attente du démarrage du build</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Le déploiement est en file d’attente. Les logs s’afficheront ici dès la première ligne.
        </p>
      </div>
    </div>
  );
}

export interface DeploymentLogsProps {
  deploymentId: string;
  /**
   * The console is 420 px tall by default. Override the height with `h-…`, or
   * let it fill a flex parent with `h-auto min-h-… flex-1`.
   */
  className?: string;
}

/** Build and deploy logs of one deployment, streaming while it is in flight. */
export function DeploymentLogs({ deploymentId, className }: DeploymentLogsProps) {
  const deployment = useDeployment(deploymentId);
  const { lines, isLoading, isStreaming, error } = useDeploymentLogs(deploymentId);
  const waiting = deployment.data?.status === "queued" && lines.length === 0;

  return (
    // The viewer takes its height from an absolutely positioned box: a
    // percentage of a flex item has no definite base otherwise.
    <div className={cn("relative h-[420px] min-h-0 w-full", className)}>
      <div className="absolute inset-0">
        {error && lines.length === 0 ? (
          <div className="flex size-full items-center justify-center rounded-xl border bg-card">
            <ErrorState compact title="Impossible de charger les logs" error={error} />
          </div>
        ) : waiting ? (
          <QueuedPlaceholder />
        ) : (
          <LogViewer
            lines={lines}
            streaming={isStreaming}
            loading={isLoading}
            title="Logs"
            showStreamFilter
            downloadName={`deployment-${shortDeploymentId(deploymentId)}`}
            emptyMessage="Aucun log pour ce déploiement."
            height="100%"
          />
        )}
      </div>
    </div>
  );
}
