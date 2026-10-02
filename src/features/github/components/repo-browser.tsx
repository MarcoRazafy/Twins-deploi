"use client";

import { useId, type ReactNode } from "react";
import { SearchX } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Stagger, StaggerItem } from "@/components/shared/motion";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import { pluralize } from "@/lib/format";
import type { GithubConnection, GithubRepo } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useRepoBrowser, type RepoStatusFilter } from "../hooks/use-repo-browser";
import { OwnerSelect } from "./owner-select";
import { RepoRow, RepoRowSkeleton } from "./repo-row";
import { SegmentedControl, type SegmentedOption } from "./segmented-control";

const STATUS_OPTIONS: ReadonlyArray<SegmentedOption<RepoStatusFilter>> = [
  { value: "all", label: "Tous" },
  { value: "deployed", label: "Déployés" },
  { value: "undeployed", label: "Non déployés" },
];

export interface RepoBrowserProps {
  connection: GithubConnection;
  onImport: (repo: GithubRepo) => void;
}

/** "Dépôts" section: search and filters over the repositories of the account. */
export function RepoBrowser({ connection, onImport }: RepoBrowserProps) {
  const titleId = useId();
  const browser = useRepoBrowser();
  const { repos, visible, byRepo } = browser;

  let body: ReactNode;
  if (repos.isPending) {
    body = (
      <div className="divide-y">
        {Array.from({ length: 5 }, (_, index) => (
          <RepoRowSkeleton key={index} />
        ))}
      </div>
    );
  } else if (repos.isError) {
    body = (
      <ErrorState
        compact
        title="Impossible de charger les dépôts"
        error={repos.error}
        onRetry={() => {
          void repos.refetch();
        }}
      />
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        compact
        icon={SearchX}
        title={browser.hasFilters ? "Aucun dépôt ne correspond" : "Aucun dépôt accessible"}
        description={
          browser.hasFilters
            ? "Modifiez votre recherche ou vos filtres pour élargir les résultats."
            : "Ce compte ne donne accès à aucun dépôt. Vérifiez les permissions du jeton."
        }
        action={
          browser.hasFilters ? (
            <Button type="button" variant="outline" size="sm" onClick={browser.reset}>
              Réinitialiser les filtres
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <Stagger as="ul" className="divide-y">
        {visible.map((repo) => (
          <StaggerItem as="li" key={repo.id}>
            <RepoRow repo={repo} services={byRepo.get(repo.fullName)} onImport={onImport} />
          </StaggerItem>
        ))}
      </Stagger>
    );
  }

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <div className="space-y-1">
        <h2 id={titleId} className="text-base font-medium">
          Dépôts
        </h2>
        <p className="text-sm text-muted-foreground">
          Les dépôts accessibles avec ce compte. Importez-en un pour créer un service.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput
          value={browser.search}
          onChange={browser.setSearch}
          placeholder="Rechercher un dépôt"
          className="sm:w-72"
        />
        <OwnerSelect connection={connection} value={browser.owner} onChange={browser.setOwner} />
        <SegmentedControl
          value={browser.status}
          onValueChange={browser.setStatus}
          options={STATUS_OPTIONS}
          label="Filtrer par état de déploiement"
          className="w-full sm:w-fit"
        />
      </div>

      <div
        aria-busy={repos.isFetching}
        className={cn(
          "@container overflow-hidden rounded-xl border bg-card transition-opacity",
          browser.isUpdating && "opacity-70",
        )}
      >
        {body}
        {visible.length > 0 ? (
          <div className="tabular border-t bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
            {pluralize(visible.length, "dépôt")}
          </div>
        ) : null}
      </div>
    </section>
  );
}
