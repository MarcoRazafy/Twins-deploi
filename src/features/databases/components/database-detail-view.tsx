"use client";

import { useId } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Cable, LayoutDashboard, Rows3, RotateCw, Settings2, Waypoints } from "lucide-react";
import { toast } from "sonner";

import { ErrorState } from "@/components/shared/error-state";
import { FadeIn } from "@/components/shared/motion";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { ProjectAvatar } from "@/components/shared/project-avatar";
import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusBadge } from "@/components/shared/status-badge";
import { UnderlineTabs, type UnderlineTab } from "@/components/shared/underline-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useHydrated } from "@/hooks/use-hydrated";
import { useQueryParam } from "@/hooks/use-query-param";
import { getErrorMessage } from "@/lib/api/contract";
import { useDatabase, useProject, useServiceAction } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { isServiceBusy } from "@/lib/status";

import { isNotFoundError, parseDatabaseTab, type DatabaseTab } from "../lib/database-utils";
import { DatabaseBackupsPanel } from "./database-backups-panel";
import { DatabaseConnectionPanel } from "./database-connection-panel";
import { DatabaseDataPanel } from "./database-data-panel";
import { DatabaseNotFound } from "./database-gate";
import { DatabaseOverview } from "./database-overview";
import { DatabaseSettingsPanel } from "./database-settings-panel";

const TABS: ReadonlyArray<UnderlineTab<DatabaseTab>> = [
  { value: "overview", label: "Aperçu", icon: LayoutDashboard },
  { value: "data", label: "Données", icon: Rows3 },
  { value: "connect", label: "Connexion", icon: Cable },
  { value: "backups", label: "Sauvegardes", icon: Archive },
  { value: "settings", label: "Réglages", icon: Settings2 },
];

/** /databases/[databaseId]: overview, data, connection, backups and settings of one database. */
export function DatabaseDetailView({ databaseId }: { databaseId: string }) {
  const router = useRouter();
  const idBase = useId();
  // The server renders the skeleton, so must the hydration pass.
  const hydrated = useHydrated();
  const query = useDatabase(databaseId);
  const database = hydrated ? query.data : undefined;
  const project = useProject(database?.projectId);
  const [tabParam, setTabParam] = useQueryParam("tab");
  const tab = parseDatabaseTab(tabParam);
  const restart = useServiceAction();

  if (!database) {
    if (hydrated && query.isError) {
      return (
        <PageContainer>
          {isNotFoundError(query.error) ? (
            <DatabaseNotFound />
          ) : (
            <ErrorState
              title="Impossible de charger la base"
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          )}
        </PageContainer>
      );
    }
    return <PageSkeleton />;
  }

  const busy = isServiceBusy(database.status);

  function handleRestart() {
    if (!database) return;
    restart.mutate(
      { id: database.serviceId, action: "restart" },
      {
        onSuccess: () => toast.success("Redémarrage lancé", { description: database.name }),
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  return (
    <PageContainer>
      <PageHeader
        backHref={routes.databases()}
        backLabel="PostgreSQL"
        icon={<ServiceIcon type="postgres" tile="lg" />}
        title={database.name}
        badge={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge kind="service" status={database.status} />
            <Badge variant="outline">PostgreSQL {database.version}</Badge>
          </span>
        }
        description={
          project.data ? (
            <Link
              href={routes.workspace(project.data.id)}
              className="inline-flex items-center gap-1.5 text-brand-400 hover:underline"
            >
              <ProjectAvatar name={project.data.name} color={project.data.color} size="xs" />
              {project.data.name}
            </Link>
          ) : undefined
        }
        actions={
          <>
            <Button
              variant="outline"
              className="max-sm:h-10"
              disabled={busy || restart.isPending}
              onClick={handleRestart}
            >
              {restart.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RotateCw data-icon="inline-start" />
              )}
              Redémarrer
            </Button>
            <Button asChild variant="secondary" className="max-sm:h-10">
              <Link href={routes.workspace(database.projectId, { service: database.serviceId })}>
                <Waypoints data-icon="inline-start" />
                Ouvrir dans le workspace
              </Link>
            </Button>
          </>
        }
      />

      <UnderlineTabs
        tabs={TABS}
        value={tab}
        onValueChange={(next) => setTabParam(next === "overview" ? null : next)}
        label="Sections de la base de données"
        idBase={idBase}
      />

      {/* Panels size themselves to this container, not to the viewport. */}
      <div
        role="tabpanel"
        id={`${idBase}-panel-${tab}`}
        aria-labelledby={`${idBase}-tab-${tab}`}
        className="@container"
      >
        <FadeIn key={tab}>
          {tab === "overview" ? <DatabaseOverview database={database} /> : null}
          {tab === "data" ? <DatabaseDataPanel databaseId={database.id} /> : null}
          {tab === "connect" ? <DatabaseConnectionPanel databaseId={database.id} /> : null}
          {tab === "backups" ? <DatabaseBackupsPanel databaseId={database.id} /> : null}
          {tab === "settings" ? (
            <DatabaseSettingsPanel
              databaseId={database.id}
              onDeleted={() => router.push(routes.databases())}
            />
          ) : null}
        </FadeIn>
      </div>
    </PageContainer>
  );
}
