"use client";

import { useId, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Link2, Rocket } from "lucide-react";

import { GithubIcon } from "@/components/icons/brand-icons";
import { CopyButton } from "@/components/shared/copy-button";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGithubBranches, useGithubConnection, useService } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { isServiceBusy } from "@/lib/status";

import { useDeployService, useGithubSourceUpdate } from "../hooks/use-github-source-update";
import { isGithubService, type GithubService } from "../lib/github-services";
import { BranchSelect, BranchesErrorRow } from "./branch-select";

function normalizeRoot(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed === "") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function SourceSettingsSkeleton() {
  return (
    <div aria-busy className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-8 w-52 rounded-lg" />
    </div>
  );
}

/** "Source" settings of a GitHub service: repo, branch, root dir, auto-deploy. */
export function GithubSourceSettings({ serviceId }: { serviceId: string }) {
  const service = useService(serviceId);

  if (service.isPending) return <SourceSettingsSkeleton />;
  if (!service.data || !isGithubService(service.data)) return null;

  return <SourceSettingsForm service={service.data} />;
}

function SourceSettingsForm({ service }: { service: GithubService }) {
  const { source } = service;
  const ids = { root: useId(), branch: useId(), auto: useId() };

  const connection = useGithubConnection();
  const branches = useGithubBranches(source.repo);
  const rootUpdate = useGithubSourceUpdate(service.id);
  const branchUpdate = useGithubSourceUpdate(service.id);
  const autoDeployUpdate = useGithubSourceUpdate(service.id);
  const { deploy, isDeploying } = useDeployService(service.id);

  const [rootDraft, setRootDraft] = useState<string | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);

  const [owner, repoName] = source.repo.split("/");
  const branch = branchUpdate.pending?.branch ?? source.branch;
  const autoDeploy = autoDeployUpdate.pending?.autoDeploy ?? source.autoDeploy;
  const rootValue = rootDraft ?? rootUpdate.pending?.rootDirectory ?? source.rootDirectory;
  const busy = isServiceBusy(service.status);

  function commitRoot() {
    if (rootDraft === null) return;
    const next = normalizeRoot(rootDraft);
    if (next === source.rootDirectory) {
      setRootDraft(null);
      setRootError(null);
      return;
    }
    setRootError(null);
    void rootUpdate.save(
      { rootDirectory: next },
      {
        success: "Répertoire racine mis à jour",
        offerRedeploy: true,
        onSuccess: () => setRootDraft(null),
        onFieldError: setRootError,
      },
    );
  }

  function handleRootKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape" && rootDraft !== null) {
      event.preventDefault();
      setRootDraft(null);
      setRootError(null);
    }
  }

  return (
    <div className="space-y-5">
      <Field>
        <FieldLabel>Dépôt source</FieldLabel>
        <div className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5">
          <GithubIcon aria-hidden className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={source.repo}>
            <span className="text-muted-foreground">{owner}/</span>
            <span className="font-medium">{repoName}</span>
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm">
                <Link href={routes.github()} aria-label="Ouvrir la page GitHub">
                  <Link2 />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Gérer GitHub</TooltipContent>
          </Tooltip>
          <CopyButton value={source.repo} tooltip="Copier le dépôt" />
        </div>
      </Field>

      <Field data-invalid={rootError ? true : undefined}>
        <FieldLabel htmlFor={ids.root}>Répertoire racine</FieldLabel>
        <div className="relative">
          <Input
            id={ids.root}
            value={rootValue}
            onChange={(event) => {
              setRootDraft(event.target.value);
              setRootError(null);
            }}
            onBlur={commitRoot}
            onKeyDown={handleRootKeyDown}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={rootError ? true : undefined}
            className="pr-9 font-mono text-[13px]"
          />
          {rootUpdate.isSaving ? (
            <Spinner
              aria-label="Enregistrement"
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
            />
          ) : null}
        </div>
        <FieldDescription>
          Dossier du dépôt qui contient l’application. Enregistré en quittant le champ.
        </FieldDescription>
        <FieldError>{rootError}</FieldError>
      </Field>

      <Field>
        <FieldLabel htmlFor={ids.branch}>Branche connectée à production</FieldLabel>
        {branches.isPending ? (
          <Skeleton className="h-9 w-full rounded-lg" />
        ) : branches.isError ? (
          <div className="space-y-2">
            <BranchesErrorRow
              onRetry={() => {
                void branches.refetch();
              }}
              githubHref={routes.github()}
              connected={connection.data?.connected !== false}
            />
            <p className="text-xs text-muted-foreground">
              Branche actuelle : <span className="font-mono text-foreground">{branch}</span>
            </p>
          </div>
        ) : (
          <>
            <BranchSelect
              id={ids.branch}
              branches={branches.data}
              value={branch}
              detailed
              disabled={branchUpdate.isSaving}
              onChange={(next) => {
                if (next === source.branch) return;
                void branchUpdate.save(
                  { branch: next },
                  { success: `Branche ${next} connectée à production`, offerRedeploy: true },
                );
              }}
            />
            <FieldDescription>
              Les mises à jour sont récupérées depuis le dernier commit de cette branche.
            </FieldDescription>
          </>
        )}
      </Field>

      <div className="flex items-start justify-between gap-4 rounded-lg bg-secondary px-3 py-2.5">
        <div className="min-w-0">
          <FieldLabel htmlFor={ids.auto}>Déployer automatiquement à chaque push</FieldLabel>
          <FieldDescription>
            Un push sur la branche {branch} lance un nouveau déploiement.
          </FieldDescription>
        </div>
        <Switch
          id={ids.auto}
          checked={autoDeploy}
          className="mt-0.5"
          onCheckedChange={(next) => {
            void autoDeployUpdate.save(
              { autoDeploy: next },
              {
                success: next
                  ? "Déploiement automatique activé"
                  : "Déploiement automatique désactivé",
              },
            );
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={isDeploying || busy}
          title={busy ? "Un déploiement est déjà en cours" : undefined}
          onClick={() => void deploy("push", `Dernier commit de ${branch}`)}
        >
          {isDeploying ? (
            <Spinner data-icon="inline-start" aria-label="Déploiement en cours" />
          ) : (
            <Rocket data-icon="inline-start" />
          )}
          Déployer le dernier commit
        </Button>
        {busy ? (
          <span className="text-xs text-muted-foreground">Un déploiement est déjà en cours.</span>
        ) : null}
      </div>
    </div>
  );
}
