"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState } from "@/components/shared/empty-state";
import { ServicePanel } from "@/features/services";
import { useQueryParam } from "@/hooks/use-query-param";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Braces } from "lucide-react";

const WIDTHS = [
  { id: "560", label: "560 px", px: 560 },
  { id: "760", label: "760 px", px: 760 },
  { id: "980", label: "980 px", px: 980 },
  { id: "full", label: "Pleine largeur", px: null },
] as const;

type WidthId = (typeof WIDTHS)[number]["id"];

/** Dev tool: the service panel inside a resizable frame on the dotted canvas. */
export function ServicePanelHarness() {
  const router = useRouter();
  const [projectId] = useQueryParam("project");
  const [serviceId] = useQueryParam("service");
  const [widthId, setWidthId] = useState<WidthId>("760");
  const width = WIDTHS.find((item) => item.id === widthId)?.px ?? null;

  if (!projectId || !serviceId) {
    return (
      <EmptyState
        icon={Braces}
        title="Paramètres manquants"
        description="Ajoutez ?project=<id>&service=<id> à l’adresse, par exemple ?project=prj_cancham&service=svc_cancham_app."
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col gap-3 bg-background bg-dot-grid p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Largeur du cadre</span>
        {WIDTHS.map((item) => (
          <Button
            key={item.id}
            size="xs"
            variant={item.id === widthId ? "secondary" : "outline"}
            aria-pressed={item.id === widthId}
            onClick={() => setWidthId(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 justify-end">
        <div
          className={cn(
            "h-full max-w-full min-w-0 overflow-hidden rounded-xl border bg-card",
            width === null && "w-full",
          )}
          style={width === null ? undefined : { width }}
        >
          <ServicePanel
            projectId={projectId}
            serviceId={serviceId}
            onClose={() => router.push("/dev/service-panel")}
          />
        </div>
      </div>
    </div>
  );
}
