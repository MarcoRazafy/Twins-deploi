"use client";

import { useEffect, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";

import { ProgressBar } from "@/components/shared/progress-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, getErrorMessage } from "@/lib/api";
import { EMPTY_VALUE, formatPercent } from "@/lib/format";
import {
  useContainerLogs,
  useContainers,
  useCreateProject,
  useDeleteProject,
  useDeployment,
  useDeploymentLogs,
  useDeployments,
  useMarkActivityRead,
  useProjects,
  useResetDemoData,
  useService,
  useServices,
  useUnreadActivityCount,
  useUpdateServicePositions,
  type LogStreamResult,
} from "@/lib/queries";
import type { DeploymentStatus, ID } from "@/lib/types";

type Counts = Array<[collection: string, records: number]>;

const COLLECTIONS = 14;

const IN_FLIGHT_STATUSES: DeploymentStatus[] = ["queued", "building", "deploying"];

async function loadCounts(): Promise<Counts> {
  const [
    projects,
    services,
    deployments,
    variables,
    domains,
    containers,
    images,
    databases,
    activity,
    members,
    tokens,
    github,
  ] = await Promise.all([
    api.projects.list(),
    api.services.list(),
    api.deployments.list(),
    api.variables.list(),
    api.domains.list(),
    api.docker.listContainers(),
    api.docker.listImages(),
    api.databases.list(),
    api.activity.list({ limit: 300 }),
    api.settings.listMembers(),
    api.settings.listTokens(),
    api.github.getConnection(),
  ]);
  const [connections, backups, repos] = await Promise.all([
    Promise.all(projects.map((project) => api.services.listConnections(project.id))),
    Promise.all(databases.map((database) => api.databases.listBackups(database.id))),
    github.connected ? api.github.listRepos() : Promise.resolve([]),
  ]);

  return [
    ["projects", projects.length],
    ["services", services.length],
    ["connections", connections.flat().length],
    ["deployments", deployments.length],
    ["variables", variables.length],
    ["domains", domains.length],
    ["containers", containers.length],
    ["images", images.length],
    ["databases", databases.length],
    ["backups", backups.flat().length],
    ["activity", activity.length],
    ["github.repos", repos.length],
    ["settings.members", members.length],
    ["settings.tokens", tokens.length],
  ];
}

function streamLabel(stream: LogStreamResult, ended: string): string {
  if (stream.error) return "erreur";
  if (stream.isLoading) return "chargement";
  return stream.isStreaming ? "en direct" : ended;
}

function ProbeRow({
  label,
  probe,
  children,
}: {
  label: string;
  probe: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="shrink-0 font-mono text-[13px] text-muted-foreground">{label}</span>
      <span className="tabular min-w-0 truncate font-medium" data-probe={probe}>
        {children}
      </span>
    </li>
  );
}

/**
 * Runtime proof of the `@/lib/queries` layer: the values below come from the
 * hooks and must move on their own (realtime bridge, log streams) without any
 * reload while the in-flight demo deployment progresses.
 */
function HooksProbe() {
  const projects = useProjects();
  const unread = useUnreadActivityCount();
  const inFlight = useDeployments({ statuses: IN_FLIGHT_STATUSES });
  // The first deployment seen in flight stays followed after it leaves that list.
  const [watchedId, setWatchedId] = useState<ID | null>(null);
  const firstInFlight = inFlight.data?.[0];
  if (watchedId === null && firstInFlight !== undefined) setWatchedId(firstInFlight.id);
  const deployment = useDeployment(watchedId);
  const logs = useDeploymentLogs(watchedId);

  const containers = useContainers(undefined, { refetchInterval: false });
  const [containerId, setContainerId] = useState<ID | null>(null);
  const firstRunning = containers.data?.find((container) => container.state === "running");
  if (containerId === null && firstRunning !== undefined) setContainerId(firstRunning.id);
  const containerLogs = useContainerLogs(containerId);

  const markRead = useMarkActivityRead();
  const resetData = useResetDemoData();
  const lastLine = logs.lines.at(-1);

  const services = useServices();
  const firstService = services.data?.[0];
  const serviceDetail = useService(firstService?.id);
  const movePositions = useUpdateServicePositions();

  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const projectRoundTrip = async () => {
    const project = await createProject.mutateAsync({ name: "Sonde hooks" });
    await deleteProject.mutateAsync(project.id);
  };

  return (
    <section className="space-y-3" aria-label="Hooks de données">
      <header className="space-y-1">
        <h2 className="text-base font-medium">Hooks de données</h2>
        <p className="text-sm text-muted-foreground">
          Valeurs lues par{" "}
          <code className="font-mono text-[13px] text-foreground">@/lib/queries</code>. Elles
          évoluent sans rechargement grâce au pont temps réel et aux flux de logs.
        </p>
      </header>

      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        <ProbeRow label="useProjects" probe="projects">
          {projects.data?.length ?? EMPTY_VALUE}
        </ProbeRow>
        <ProbeRow label="useUnreadActivityCount" probe="unread">
          {unread}
        </ProbeRow>
        <ProbeRow label="useDeployments" probe="watched">
          {watchedId ?? EMPTY_VALUE}
        </ProbeRow>
        <ProbeRow label="useDeployment" probe="deployment">
          {deployment.data
            ? `${deployment.data.status} · ${formatPercent(deployment.data.progress)}`
            : EMPTY_VALUE}
        </ProbeRow>
        <li className="px-4 pb-3 pt-1">
          <ProgressBar
            value={deployment.data?.progress ?? 0}
            tone="info"
            label="Progression du déploiement suivi"
          />
        </li>
        <ProbeRow label="useDeploymentLogs · lignes" probe="log-count">
          {logs.lines.length}
        </ProbeRow>
        <ProbeRow label="useDeploymentLogs · flux" probe="log-state">
          {streamLabel(logs, "terminé")}
        </ProbeRow>
        <ProbeRow label="dernière ligne" probe="log-last">
          {lastLine?.message ?? EMPTY_VALUE}
        </ProbeRow>
        <ProbeRow label="useContainerLogs · lignes" probe="container-log-count">
          {containerLogs.lines.length}
        </ProbeRow>
        <ProbeRow label="useContainerLogs · flux" probe="container-log-state">
          {streamLabel(containerLogs, "à l’arrêt")}
        </ProbeRow>
        <ProbeRow label="useServices · position" probe="service-position">
          {firstService ? `${firstService.position.x}, ${firstService.position.y}` : EMPTY_VALUE}
        </ProbeRow>
        <ProbeRow label="useService · position" probe="service-detail-position">
          {serviceDetail.data
            ? `${serviceDetail.data.position.x}, ${serviceDetail.data.position.y}`
            : EMPTY_VALUE}
        </ProbeRow>
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => markRead.mutate("all")}
          disabled={markRead.isPending}
        >
          Tout marquer comme lu
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={firstService === undefined}
          onClick={() => {
            if (!firstService) return;
            const { x, y } = firstService.position;
            movePositions.mutate({ [firstService.id]: { x: x + 24, y } });
          }}
        >
          Déplacer le service
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={createProject.isPending || deleteProject.isPending}
          onClick={() => void projectRoundTrip().catch(() => undefined)}
        >
          Créer puis supprimer un projet
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => resetData.mutate()}
          disabled={resetData.isPending}
        >
          {resetData.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RotateCcw data-icon="inline-start" />
          )}
          Réinitialiser (hook)
        </Button>
      </div>
    </section>
  );
}

/**
 * Development-only page: importing `api` installs `window.__miniRailway`, so
 * QA scripts can drive the mock backend before the real screens exist.
 */
export default function MockBackendPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let mounted = true;
    let pending: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      loadCounts().then(
        (next) => {
          if (!mounted) return;
          setCounts(next);
          setError(null);
        },
        (reason: unknown) => {
          if (mounted) setError(getErrorMessage(reason));
        },
      );
    };

    refresh();
    // Events come in bursts while a deployment runs: one refresh per burst.
    const unsubscribe = api.events.subscribe(() => {
      if (pending !== null) return;
      pending = setTimeout(() => {
        pending = null;
        refresh();
      }, 400);
    });

    return () => {
      mounted = false;
      unsubscribe();
      if (pending !== null) clearTimeout(pending);
    };
  }, []);

  const reset = async () => {
    setResetting(true);
    try {
      await api.settings.resetDemoData();
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setResetting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-md space-y-6 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Mock backend</h1>
        <p className="text-sm text-muted-foreground">
          Enregistrements par collection du backend simulé. Cette page charge aussi le point
          d’entrée de débogage{" "}
          <code className="font-mono text-[13px] text-foreground">window.__miniRailway</code>.
        </p>
      </header>

      <HooksProbe />

      <section className="overflow-hidden rounded-xl border bg-card" aria-busy={counts === null}>
        <ul className="divide-y">
          {counts === null
            ? Array.from({ length: COLLECTIONS }, (_, index) => (
                <li key={index} className="flex items-center justify-between px-4 py-2.5">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-8" />
                </li>
              ))
            : counts.map(([collection, records]) => (
                <li key={collection} className="flex items-center justify-between px-4 py-2.5">
                  <span className="font-mono text-[13px] text-muted-foreground">{collection}</span>
                  <span className="tabular font-medium" data-collection={collection}>
                    {records}
                  </span>
                </li>
              ))}
        </ul>
      </section>

      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button variant="outline" onClick={reset} disabled={resetting}>
        {resetting ? <Spinner data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
        Réinitialiser
      </Button>
    </main>
  );
}
