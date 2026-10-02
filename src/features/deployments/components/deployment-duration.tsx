"use client";

import { useNow } from "@/hooks/use-now";
import { EMPTY_VALUE, formatDuration } from "@/lib/format";
import { isDeploymentInFlight } from "@/lib/status";
import type { Deployment } from "@/lib/types";
import { cn } from "@/lib/utils";

import { deploymentStartTime, finishedDurationMs, formatElapsed } from "../lib/deployment-utils";

function LiveDuration({ since, className }: { since: number; className?: string }) {
  // Only in-flight deployments subscribe to the one-second ticker.
  const now = useNow(1000);
  // Whole seconds: "0 s" reads better than "0 ms" for a deployment that just started.
  const seconds = Math.floor(Math.max(0, now - since) / 1000);
  return (
    <span className={cn("tabular", className)}>
      {now === 0 ? EMPTY_VALUE : seconds === 0 ? "0 s" : formatDuration(seconds * 1000)}
    </span>
  );
}

export interface DeploymentDurationProps {
  deployment: Deployment;
  className?: string;
}

/** Elapsed time ticking every second while in flight, the final duration afterwards. */
export function DeploymentDuration({ deployment, className }: DeploymentDurationProps) {
  if (isDeploymentInFlight(deployment.status)) {
    return <LiveDuration since={deploymentStartTime(deployment)} className={className} />;
  }
  return (
    <span className={cn("tabular", className)}>{formatElapsed(finishedDurationMs(deployment))}</span>
  );
}
