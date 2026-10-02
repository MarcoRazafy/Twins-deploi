"use client";

import { ServiceRuntimeLogs } from "./service-runtime-logs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Container } from "@/lib/types";

export interface ContainerLogsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kept after closing so the content does not vanish during the exit animation. */
  container: Container | null;
}

export function ContainerLogsSheet({ open, onOpenChange, container }: ContainerLogsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Logs{container ? ` de ${container.name}` : ""}</SheetTitle>
          <SheetDescription className="truncate font-mono text-xs">
            {container?.image ?? ""}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 p-4">
          {container ? <ServiceRuntimeLogs serviceId={container.serviceId} fill /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
