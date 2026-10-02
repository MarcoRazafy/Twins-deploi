"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getErrorMessage, isApiError, type UpdateServiceInput } from "@/lib/api/contract";
import { useTriggerDeployment, useUpdateService } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { GithubSource } from "@/lib/types";

export type GithubSourcePatch = Partial<
  Pick<GithubSource, "branch" | "rootDirectory" | "autoDeploy">
>;

export interface SaveSourceOptions {
  /** Headline of the success toast. */
  success: string;
  /** Adds a "Redéployer" action: editing the source never rebuilds what is running. */
  offerRedeploy?: boolean;
  onSuccess?: () => void;
  /** Receives the message of an error tied to a form field instead of a toast. */
  onFieldError?: (message: string) => void;
}

/** The GitHub part of a service patch (the union also covers Docker sources). */
function readGithubPatch(source: UpdateServiceInput["source"]): GithubSourcePatch {
  const patch: GithubSourcePatch = {};
  if (!source) return patch;
  if ("branch" in source && source.branch !== undefined) patch.branch = source.branch;
  if ("rootDirectory" in source && source.rootDirectory !== undefined) {
    patch.rootDirectory = source.rootDirectory;
  }
  if ("autoDeploy" in source && source.autoDeploy !== undefined) {
    patch.autoDeploy = source.autoDeploy;
  }
  return patch;
}

/**
 * Starts a deployment of a service and reports it. Promise based on purpose:
 * it keeps working from a toast action after the component is gone.
 */
export function useDeployService(serviceId: string) {
  const router = useRouter();
  const trigger = useTriggerDeployment();
  const { mutateAsync } = trigger;

  async function deploy(kind: "push" | "config", description?: string): Promise<void> {
    try {
      const deployment = await mutateAsync({ serviceId, trigger: kind });
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

  return { deploy, isDeploying: trigger.isPending };
}

/**
 * Saves one edit of a GitHub source (branch, root directory, auto-deploy).
 * `pending` holds the value being saved so a control can show it right away
 * instead of waiting for the refetch.
 */
export function useGithubSourceUpdate(serviceId: string) {
  const update = useUpdateService();
  const { deploy } = useDeployService(serviceId);
  const { mutateAsync } = update;

  async function save(patch: GithubSourcePatch, options: SaveSourceOptions): Promise<void> {
    try {
      await mutateAsync({ id: serviceId, patch: { source: patch } });
    } catch (error) {
      if (isApiError(error) && error.field && options.onFieldError) {
        options.onFieldError(error.message);
      } else {
        toast.error(getErrorMessage(error));
      }
      return;
    }

    toast.success(
      options.success,
      options.offerRedeploy
        ? {
            description: "Redéployez pour appliquer ce changement.",
            action: { label: "Redéployer", onClick: () => void deploy("config") },
          }
        : undefined,
    );
    options.onSuccess?.();
  }

  return {
    save,
    pending: update.isPending ? readGithubPatch(update.variables?.patch.source) : null,
    isSaving: update.isPending,
  };
}
