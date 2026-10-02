"use client";

import { toast } from "sonner";

import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { useUpdateService } from "@/lib/queries";
import type { UpdateServiceInput } from "@/lib/api/contract";

import { useServiceDeploy } from "./use-service-deploy";

/** Errors keyed by the short field name ("port", "sizeGb"…). */
export type FieldErrors = Record<string, string>;

interface SaveOptions {
  /** Field names the form shows inline; any other error becomes a toast. */
  fields: readonly string[];
  onFieldErrors: (errors: FieldErrors) => void;
  /** Toast title (default "Réglages enregistrés"). */
  message?: string;
}

/**
 * Saves a settings patch. Validation errors of a known field are handed back
 * for inline display; a success toast offers to redeploy so the change applies.
 */
export function useSaveService(serviceId: string) {
  const update = useUpdateService();
  const { deploy } = useServiceDeploy(serviceId);
  const { mutateAsync, isPending } = update;

  async function save(patch: UpdateServiceInput, options: SaveOptions): Promise<boolean> {
    try {
      await mutateAsync({ id: serviceId, patch });
      toast.success(options.message ?? "Réglages enregistrés", {
        description: "Redéployez le service pour appliquer ces changements.",
        action: { label: "Redéployer", onClick: () => void deploy("config") },
      });
      return true;
    } catch (error) {
      const field = isApiError(error) ? error.field?.split(".").pop() : undefined;
      if (field && options.fields.includes(field)) {
        options.onFieldErrors({ [field]: getErrorMessage(error) });
      } else {
        toast.error(getErrorMessage(error));
      }
      return false;
    }
  }

  return { save, isPending };
}
