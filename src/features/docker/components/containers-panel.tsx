"use client";

import { useState } from "react";
import { Container as ContainerIcon, Rocket, SearchX } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ProjectSelect } from "@/components/shared/project-select";
import { SearchInput } from "@/components/shared/search-input";
import { TableShell } from "@/components/shared/table-shell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNow } from "@/hooks/use-now";
import { useQueryParam } from "@/hooks/use-query-param";
import { getErrorMessage } from "@/lib/api/contract";
import { pluralize } from "@/lib/format";
import { useContainers, useDeleteService, useProjects, useServices } from "@/lib/queries";
import { CONTAINER_STATE } from "@/lib/status";
import type { Container, ContainerState } from "@/lib/types";

import { useContainerControls } from "../hooks/use-container-controls";
import { ContainerLogsSheet } from "./container-logs-sheet";
import { ContainerRow, ContainerRowSkeleton } from "./container-row";

type StateFilter = "all" | ContainerState;

const STATE_FILTERS = Object.keys(CONTAINER_STATE) as ContainerState[];

function ContainersHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead className="px-3!">Conteneur</TableHead>
        <TableHead className="px-3! hidden md:table-cell">Image</TableHead>
        <TableHead className="px-3! hidden lg:table-cell">Projet</TableHead>
        <TableHead className="px-3!">État</TableHead>
        <TableHead className="px-3! hidden lg:table-cell">CPU</TableHead>
        <TableHead className="px-3! hidden lg:table-cell">Mémoire</TableHead>
        <TableHead className="px-3! hidden md:table-cell">Activité</TableHead>
        <TableHead className="px-3! text-right">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

export interface ContainersPanelProps {
  onDeploy: () => void;
}

/** "Conteneurs" tab: filters, live table and the row actions with their dialogs. */
export function ContainersPanel({ onDeploy }: ContainersPanelProps) {
  const containers = useContainers();
  const projects = useProjects();
  const services = useServices();
  const now = useNow(1000);
  const { pending, run } = useContainerControls();
  const deleteService = useDeleteService();

  const [projectId, setProjectId] = useQueryParam("project");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [logs, setLogs] = useState<{ open: boolean; container: Container | null }>({
    open: false,
    container: null,
  });
  const [removal, setRemoval] = useState<{ open: boolean; container: Container | null }>({
    open: false,
    container: null,
  });

  const projectById = new Map(projects.data?.map((project) => [project.id, project]));
  const serviceById = new Map(services.data?.map((service) => [service.id, service]));

  const needle = search.trim().toLowerCase();
  const rows = (containers.data ?? []).filter((container) => {
    if (projectId && container.projectId !== projectId) return false;
    if (stateFilter !== "all" && container.state !== stateFilter) return false;
    if (needle === "") return true;
    return (
      container.name.toLowerCase().includes(needle) ||
      container.image.toLowerCase().includes(needle) ||
      container.id.toLowerCase().includes(needle)
    );
  });
  const filtering = Boolean(projectId) || stateFilter !== "all" || needle !== "";

  const removalService = removal.container ? serviceById.get(removal.container.serviceId) : undefined;
  const removalName = removalService?.name ?? removal.container?.name ?? "";

  function confirmRemoval() {
    const target = removal.container;
    if (!target) return;
    deleteService.mutate(target.serviceId, {
      onSuccess: () => {
        toast.success(`Service ${removalName} supprimé`);
        setRemoval((current) => ({ ...current, open: false }));
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  }

  const toolbar = (
    <>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Rechercher un conteneur, une image…"
        label="Rechercher un conteneur"
        className="w-full sm:w-72"
      />
      <ProjectSelect
        allowAll
        value={projectId}
        onChange={setProjectId}
        aria-label="Filtrer par projet"
        className="w-full sm:w-48"
      />
      <Select value={stateFilter} onValueChange={(value) => setStateFilter(value as StateFilter)}>
        <SelectTrigger aria-label="Filtrer par état" className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les états</SelectItem>
          {STATE_FILTERS.map((state) => (
            <SelectItem key={state} value={state}>
              {CONTAINER_STATE[state].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  let body;
  if (containers.isPending) {
    body = (
      <TableShell toolbar={toolbar}>
        <Table aria-busy>
          <ContainersHead />
          <TableBody>
            {Array.from({ length: 5 }, (_, index) => (
              <ContainerRowSkeleton key={index} />
            ))}
          </TableBody>
        </Table>
      </TableShell>
    );
  } else if (containers.isError && !containers.data) {
    body = (
      <ErrorState
        title="Impossible de charger les conteneurs"
        error={containers.error}
        onRetry={() => {
          void containers.refetch();
        }}
      />
    );
  } else if ((containers.data ?? []).length === 0) {
    body = (
      <EmptyState
        icon={ContainerIcon}
        title="Aucun conteneur"
        description="Déployez une image Docker ou un dépôt GitHub : son conteneur apparaîtra ici avec ses métriques en direct."
        action={
          <Button type="button" onClick={onDeploy}>
            <Rocket data-icon="inline-start" />
            Déployer une image
          </Button>
        }
      />
    );
  } else {
    body = (
      <TableShell
        toolbar={toolbar}
        footer={
          <span aria-live="polite">
            {rows.length} sur {pluralize(containers.data?.length ?? 0, "conteneur")}
          </span>
        }
      >
        <Table>
          <ContainersHead />
          <TableBody>
            <AnimatePresence initial={false}>
              {rows.map((container) => (
                <ContainerRow
                  key={container.id}
                  container={container}
                  project={projectById.get(container.projectId)}
                  serviceName={serviceById.get(container.serviceId)?.name}
                  now={now}
                  busy={pending[container.id]}
                  onRun={(target, action) => void run(target, action)}
                  onShowLogs={(target) => setLogs({ open: true, container: target })}
                  onDelete={(target) => setRemoval({ open: true, container: target })}
                />
              ))}
            </AnimatePresence>
          </TableBody>
        </Table>
        {rows.length === 0 && filtering ? (
          <EmptyState
            compact
            icon={SearchX}
            title="Aucun résultat"
            description="Aucun conteneur ne correspond à ces filtres."
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setStateFilter("all");
                  setProjectId(null);
                }}
              >
                Réinitialiser les filtres
              </Button>
            }
          />
        ) : null}
      </TableShell>
    );
  }

  return (
    <>
      {body}
      <ContainerLogsSheet
        open={logs.open}
        onOpenChange={(open) => setLogs((current) => ({ ...current, open }))}
        container={logs.container}
      />
      <ConfirmDialog
        open={removal.open}
        onOpenChange={(open) => setRemoval((current) => ({ ...current, open }))}
        tone="danger"
        title="Supprimer le service"
        description={`Le service ${removalName}, son conteneur, ses déploiements, ses variables et ses domaines seront supprimés définitivement.`}
        confirmText={removalName}
        loading={deleteService.isPending}
        onConfirm={confirmRemoval}
      />
    </>
  );
}
