"use client";

import { useState } from "react";
import { CircleX, Ellipsis, FileText, History, Rocket, SearchX } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { RelativeTime } from "@/components/shared/relative-time";
import { SearchInput } from "@/components/shared/search-input";
import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusBadge } from "@/components/shared/status-badge";
import { TableShell } from "@/components/shared/table-shell";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, pluralize, shortSha } from "@/lib/format";
import { canRollbackTo, DEPLOYMENT_STATUS, isDeploymentInFlight } from "@/lib/status";
import type { DeploymentStatus } from "@/lib/types";

import { KitSection } from "./kit-section";
import { SAMPLE_DEPLOYMENTS } from "./sample-data";
import { useMountTime } from "./use-client-value";

const STATUS_FILTERS: DeploymentStatus[] = ["building", "active", "removed", "failed", "cancelled"];

interface TablesSectionProps {
  loading: boolean;
}

export function TablesSection({ loading }: TablesSectionProps) {
  const mountTime = useMountTime();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const query = search.trim().toLowerCase();
  const rows = SAMPLE_DEPLOYMENTS.filter(
    (deployment) =>
      (status === "all" || deployment.status === status) &&
      (!query ||
        deployment.service.toLowerCase().includes(query) ||
        deployment.message.toLowerCase().includes(query)),
  );

  return (
    <KitSection
      id="tableaux"
      title="Tableaux"
      description="TableShell fournit la carte, la barre d’outils et le pied, et applique la recette aux composants Table de shadcn. Sur mobile, les colonnes secondaires disparaissent et le tableau défile dans sa carte."
    >
      <TableShell
        toolbar={
          <>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Rechercher un déploiement…"
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filtrer par statut">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                {STATUS_FILTERS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {DEPLOYMENT_STATUS[option].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="w-full sm:ml-auto sm:w-auto" onClick={() => toast.success("Déploiement lancé")}>
              <Rocket data-icon="inline-start" />
              Déployer
            </Button>
          </>
        }
        footer={
          <>
            <span>
              {pluralize(rows.length, "déploiement")} sur {SAMPLE_DEPLOYMENTS.length}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="xs" disabled>
                Précédent
              </Button>
              <Button variant="outline" size="xs">
                Suivant
              </Button>
            </div>
          </>
        }
      >
        {!loading && rows.length === 0 ? (
          <EmptyState
            compact
            icon={SearchX}
            title="Aucun déploiement ne correspond"
            description="Modifiez la recherche ou le filtre de statut."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                }}
              >
                Réinitialiser les filtres
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="hidden lg:table-cell">Commit ou image</TableHead>
                <TableHead className="hidden md:table-cell">Auteur</TableHead>
                <TableHead className="hidden sm:table-cell">Créé</TableHead>
                <TableHead className="hidden text-right md:table-cell">Durée</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 5 }, (_, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Skeleton className="size-7 rounded-md" />
                          <Skeleton className="h-4 w-24" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-28 rounded-full" />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Skeleton className="h-4 w-56" />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Skeleton className="ml-auto h-4 w-14" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="size-7 rounded-md" />
                      </TableCell>
                    </TableRow>
                  ))
                : rows.map((deployment) => (
                    <TableRow key={deployment.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <ServiceIcon type={deployment.type} tile="sm" />
                          <span className="font-medium">{deployment.service}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="deployment" status={deployment.status} />
                      </TableCell>
                      <TableCell className="hidden max-w-72 lg:table-cell">
                        <div className="flex items-center gap-2">
                          {deployment.sha ? (
                            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                              {shortSha(deployment.sha)}
                            </code>
                          ) : null}
                          <span className="truncate text-muted-foreground" title={deployment.message}>
                            {deployment.message}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <UserAvatar name={deployment.author} size="sm" />
                          <span className="text-muted-foreground">{deployment.author}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        <RelativeTime
                          date={mountTime === 0 ? null : mountTime - deployment.ageMs}
                        />
                      </TableCell>
                      <TableCell className="tabular hidden text-right text-muted-foreground md:table-cell">
                        {deployment.durationMs === null
                          ? "—"
                          : formatDuration(deployment.durationMs)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions du déploiement de ${deployment.service}`}
                            >
                              <Ellipsis />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onSelect={() => toast("Ouverture des logs")}>
                              <FileText />
                              Voir les logs
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!canRollbackTo(deployment.status)}
                              onSelect={() => toast.success("Version restaurée")}
                            >
                              <History />
                              Restaurer cette version
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={!isDeploymentInFlight(deployment.status)}
                              onSelect={() => toast("Déploiement annulé")}
                            >
                              <CircleX />
                              Annuler le déploiement
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        )}
      </TableShell>
    </KitSection>
  );
}
