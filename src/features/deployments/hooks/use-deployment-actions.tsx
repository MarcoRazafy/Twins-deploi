"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { getErrorMessage } from "@/lib/api/contract";
import {
  useCancelDeployment,
  useRollbackDeployment,
  useServices,
  useTriggerDeployment,
} from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { Deployment } from "@/lib/types";

import { deploymentTitle } from "../lib/deployment-utils";

interface ConfirmRequest {
  kind: "rollback" | "cancel";
  deployment: Deployment;
}

export interface DeploymentActions {
  /** Manual deployment of a service (the "Déployer" button). */
  deploy: (serviceId: string, options?: { replacesInFlight?: boolean }) => Promise<void>;
  /** Accepts a deployment, or just the service when there is no deployment to point at. */
  redeploy: (target: { serviceId: string }) => Promise<void>;
  /** Opens the confirmation; the rollback runs once confirmed. */
  requestRollback: (deployment: Deployment) => void;
  /** Opens the confirmation; the cancellation runs once confirmed. */
  requestCancel: (deployment: Deployment) => void;
  /** A deploy or redeploy request is on its way. */
  launching: boolean;
  /** Confirmation dialogs: render them once, next to the UI that calls the actions. */
  dialogs: ReactNode;
}

/**
 * Every deployment action of the feature, with its toasts and confirmations.
 * One instance per list or page: rows only call it, they never own a dialog.
 * Mutations use `mutateAsync` so the toast still appears after navigating away.
 */
export function useDeploymentActions(): DeploymentActions {
  const router = useRouter();
  const services = useServices();
  const { mutateAsync: triggerAsync, isPending: launching } = useTriggerDeployment();
  const { mutateAsync: rollbackAsync } = useRollbackDeployment();
  const { mutateAsync: cancelAsync } = useCancelDeployment();

  // The request outlives `open` so the dialog keeps its text while it fades out.
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);

  const serviceName = useCallback(
    (serviceId: string) =>
      services.data?.find((service) => service.id === serviceId)?.name ?? "ce service",
    [services.data],
  );

  const follow = useCallback(
    (deploymentId: string) => ({
      label: "Suivre",
      onClick: () => router.push(routes.deployment(deploymentId)),
    }),
    [router],
  );

  const launch = useCallback(
    async (serviceId: string, kind: "manual" | "redeploy", replacesInFlight = false) => {
      const name = serviceName(serviceId);
      try {
        const created = await triggerAsync({ serviceId, trigger: kind });
        toast.success(kind === "manual" ? "Déploiement lancé" : "Redéploiement lancé", {
          description: replacesInFlight
            ? `${name} · le déploiement en cours est remplacé.`
            : name,
          action: follow(created.id),
        });
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    },
    [follow, serviceName, triggerAsync],
  );

  const deploy = useCallback(
    (serviceId: string, options?: { replacesInFlight?: boolean }) =>
      launch(serviceId, "manual", options?.replacesInFlight),
    [launch],
  );

  const redeploy = useCallback(
    (target: { serviceId: string }) => launch(target.serviceId, "redeploy"),
    [launch],
  );

  const requestRollback = useCallback((deployment: Deployment) => {
    setRequest({ kind: "rollback", deployment });
    setOpen(true);
  }, []);

  const requestCancel = useCallback((deployment: Deployment) => {
    setRequest({ kind: "cancel", deployment });
    setOpen(true);
  }, []);

  const confirm = useCallback(async () => {
    if (!request) return;
    const { kind, deployment } = request;
    const name = serviceName(deployment.serviceId);
    try {
      if (kind === "rollback") {
        const created = await rollbackAsync(deployment.id);
        toast.success("Restauration lancée", {
          description: `${name} · ${deploymentTitle(deployment)}`,
          action: follow(created.id),
        });
      } else {
        await cancelAsync(deployment.id);
        toast.success("Déploiement annulé", { description: name });
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setOpen(false);
    }
  }, [cancelAsync, follow, request, rollbackAsync, serviceName]);

  const dialogs = request ? (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      tone={request.kind === "cancel" ? "danger" : "default"}
      title={request.kind === "cancel" ? "Annuler le déploiement ?" : "Restaurer cette version ?"}
      description={
        request.kind === "cancel"
          ? `Le déploiement de ${serviceName(request.deployment.serviceId)} sera interrompu. S’il y en a une, la version actuellement en ligne reste active.`
          : `« ${deploymentTitle(request.deployment)} » sera redéployée sur ${serviceName(request.deployment.serviceId)} et remplacera la version actuellement active.`
      }
      confirmLabel={request.kind === "cancel" ? "Annuler le déploiement" : "Restaurer"}
      cancelLabel={request.kind === "cancel" ? "Poursuivre" : "Annuler"}
      onConfirm={confirm}
    />
  ) : null;

  return { deploy, redeploy, requestRollback, requestCancel, launching, dialogs };
}
