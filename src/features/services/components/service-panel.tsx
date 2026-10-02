"use client";

import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SearchX, X } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { UnderlineTabs } from "@/components/shared/underline-tabs";
import { Button } from "@/components/ui/button";
import { DatabaseBackupsPanel, DatabaseConnectionPanel, DatabaseDataPanel } from "@/features/databases";
import { ServiceDeployments } from "@/features/deployments";
import { ServiceRuntimeLogs } from "@/features/docker";
import { VariablesEditor } from "@/features/variables";
import { useHotkey } from "@/hooks/use-hotkey";
import { useQueryParam } from "@/hooks/use-query-param";
import { isApiError } from "@/lib/api/contract";
import { useService } from "@/lib/queries";
import { DURATION, EASE } from "@/lib/motion";
import type { ServiceTab } from "@/lib/routes";
import type { Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import { resolveServiceTab, SERVICE_TAB_LABELS, tabsForType } from "../lib/service-tabs";
import { DatabaseByService } from "./database-by-service";
import { ServiceMetricsPanel } from "./service-metrics-panel";
import { ServicePanelHeader } from "./service-panel-header";
import { ServicePanelSkeleton } from "./service-panel-skeleton";
import { PANEL_SCROLL_ATTRIBUTE, ServiceSettings } from "./service-settings";

export interface ServicePanelProps {
  projectId: string;
  serviceId: string;
  onClose: () => void;
}

interface TabContentProps {
  tab: ServiceTab;
  service: Service;
  projectId: string;
  onClose: () => void;
}

function TabContent({ tab, service, projectId, onClose }: TabContentProps) {
  switch (tab) {
    case "deployments":
      return <ServiceDeployments serviceId={service.id} />;
    case "variables":
      return <VariablesEditor projectId={projectId} serviceId={service.id} />;
    case "metrics":
      return <ServiceMetricsPanel serviceId={service.id} />;
    case "logs":
      return <ServiceRuntimeLogs serviceId={service.id} fill />;
    case "data":
      return (
        <DatabaseByService serviceId={service.id}>
          {(databaseId) => <DatabaseDataPanel databaseId={databaseId} />}
        </DatabaseByService>
      );
    case "connect":
      return (
        <DatabaseByService serviceId={service.id}>
          {(databaseId) => <DatabaseConnectionPanel databaseId={databaseId} />}
        </DatabaseByService>
      );
    case "backups":
      return (
        <DatabaseByService serviceId={service.id}>
          {(databaseId) => <DatabaseBackupsPanel databaseId={databaseId} />}
        </DatabaseByService>
      );
    case "settings":
      return <ServiceSettings service={service} onDeleted={onClose} />;
  }
}

function LoadedPanel({ service, projectId, onClose }: Omit<TabContentProps, "tab">) {
  const [rawTab, setRawTab] = useQueryParam("tab");
  const scrollRef = useRef<HTMLDivElement>(null);
  const type = service.source.type;
  const tab = resolveServiceTab(rawTab, type);
  const idBase = `service-${service.id}`;
  const tabs = tabsForType(type).map((value) => ({ value, label: SERVICE_TAB_LABELS[value] }));

  function selectTab(next: ServiceTab) {
    setRawTab(next);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  return (
    <div className="flex h-full flex-col bg-card @container">
      <ServicePanelHeader service={service} onClose={onClose} />
      <UnderlineTabs
        tabs={tabs}
        value={tab}
        onValueChange={selectTab}
        label="Sections du service"
        idBase={idBase}
        className="border-b px-4 @md:px-6"
      />
      <div ref={scrollRef} {...{ [PANEL_SCROLL_ATTRIBUTE]: "" }} className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            role="tabpanel"
            id={`${idBase}-panel-${tab}`}
            aria-labelledby={`${idBase}-tab-${tab}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: DURATION.base, ease: EASE.out } }}
            exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
            className={cn("p-4 @md:p-6", tab === "logs" ? "h-full" : "min-h-full")}
          >
            <TabContent tab={tab} service={service} projectId={projectId} onClose={onClose} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * Detail panel of a service, rendered by the workspace over the canvas. The
 * active tab lives in the `tab` query parameter.
 */
export function ServicePanel({ projectId, serviceId, onClose }: ServicePanelProps) {
  const service = useService(serviceId);
  // Escape closes the panel unless a dialog, menu or field consumed it first.
  useHotkey("escape", onClose);

  if (service.isPending) return <ServicePanelSkeleton />;

  const notFound = service.isError && isApiError(service.error) && service.error.code === "not_found";
  if (notFound || (!service.data && !service.isError)) {
    return (
      <div className="relative flex h-full flex-col bg-card">
        <div className="absolute top-3 right-3">
          <Button variant="ghost" size="icon" aria-label="Fermer le panneau" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="grid flex-1 place-items-center p-6">
          <EmptyState
            compact
            icon={SearchX}
            title="Service introuvable"
            description="Ce service a été supprimé ou n’existe plus."
            action={
              <Button variant="outline" size="sm" onClick={onClose}>
                Fermer
              </Button>
            }
          />
        </div>
      </div>
    );
  }
  if (!service.data) {
    return (
      <div className="grid h-full place-items-center bg-card p-6">
        <ErrorState
          compact
          title="Impossible de charger le service"
          error={service.error}
          onRetry={() => void service.refetch()}
        />
      </div>
    );
  }

  return <LoadedPanel service={service.data} projectId={projectId} onClose={onClose} />;
}
