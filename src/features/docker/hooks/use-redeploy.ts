"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/api/contract";
import { useTriggerDeployment } from "@/lib/queries";
import { routes } from "@/lib/routes";

/**
 * Triggers a deployment and reports it. Promise based so it also works from a
 * toast action after the calling component is gone.
 */
export function useRedeploy(serviceId: string) {
  const router = useRouter();
  const { mutateAsync, isPending } = useTriggerDeployment();

  async function redeploy(trigger: "redeploy" | "config", description?: string): Promise<void> {
    try {
      const deployment = await mutateAsync({ serviceId, trigger });
      toast.success("Déploiement lancé", {
        description,
        action: {
          label: "Voir le déploiement",
          onClick: () => router.push(routes.deployment(deployment.id)),
        },
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return { redeploy, isRedeploying: isPending };
}
