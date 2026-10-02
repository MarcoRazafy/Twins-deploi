"use client";

import { useState } from "react";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/api/contract";
import { useContainerAction } from "@/lib/queries";
import type { Container, ContainerAction } from "@/lib/types";

const DONE_LABEL: Record<ContainerAction, string> = {
  start: "démarré",
  stop: "arrêté",
  restart: "redémarré",
};

/** Start, stop or restart containers, tracking which row is busy and with what. */
export function useContainerControls() {
  const { mutateAsync } = useContainerAction();
  const [pending, setPending] = useState<Record<string, ContainerAction>>({});

  async function run(container: Container, action: ContainerAction): Promise<void> {
    setPending((current) => ({ ...current, [container.id]: action }));
    try {
      await mutateAsync({ containerId: container.id, action });
      toast.success(`Conteneur ${container.name} ${DONE_LABEL[action]}`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPending((current) => {
        const next = { ...current };
        delete next[container.id];
        return next;
      });
    }
  }

  return { pending, run };
}
