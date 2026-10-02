import { toast } from "sonner";

import { getErrorMessage, isApiError } from "@/lib/api/contract";

/** A "forbidden" error is a rule of the platform, not a failure: it gets its own title. */
export function notifyError(error: unknown): void {
  if (isApiError(error) && error.code === "forbidden") {
    toast.error("Action non autorisée", { description: error.message });
    return;
  }
  toast.error(getErrorMessage(error));
}
