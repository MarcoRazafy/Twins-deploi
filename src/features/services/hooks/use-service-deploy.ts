"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/api/contract";
import { useTriggerDeployment, type RequestedDeploymentTrigger } from "@/lib/queries";
import { routes } from "@/lib/routes";

/**
 * Starts a deployment and gives the feedback (toast with a link to it).
 * `deploy` uses `mutateAsync` so the toast still appears when the caller
 * unmounted meanwhile (a settings form is re-keyed as soon as it is saved).
 */
export function useServiceDeploy(serviceId: string) {
  const router = useRouter();
  const trigger = useTriggerDeployment();
  const { mutateAsync, isPending } = trigger;

  async function deploy(kind: RequestedDeploymentTrigger = "manual") {
    try {
      const deployment = await mutateAsync({ serviceId, trigger: kind });
      toast.success("Déploiement lancé", {
        action: {
          label: "Voir",
          onClick: () => router.push(routes.deployment(deployment.id)),
        },
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return { deploy, isPending };
}
