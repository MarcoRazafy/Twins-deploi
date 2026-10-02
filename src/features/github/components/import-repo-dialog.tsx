"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Plus, Rocket, SearchX } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { GithubIcon } from "@/components/icons/brand-icons";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ProjectSelect } from "@/components/shared/project-select";
import { SearchInput } from "@/components/shared/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { API_MODE } from "@/lib/api";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { fadeUp } from "@/lib/motion";
import {
  useCreateProject,
  useGithubBranches,
  useGithubConnection,
  useImportRepo,
  useProjects,
} from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { Builder, GithubConnection, GithubRepo, Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useRepoBrowser } from "../hooks/use-repo-browser";
import { BranchSelect, BranchesErrorRow } from "./branch-select";
import { ConnectGithubDialog } from "./connect-github-dialog";
import { OwnerSelect } from "./owner-select";
import { RepoPickerRow, RepoPickerRowSkeleton } from "./repo-row";
import { SegmentedControl, type SegmentedOption } from "./segmented-control";

const BUILDER_OPTIONS: ReadonlyArray<SegmentedOption<Builder>> = [
  { value: "nixpacks", label: "Nixpacks" },
  { value: "dockerfile", label: "Dockerfile" },
];

const NAME_MIN = 2;
const NAME_MAX = 40;
const NAME_ERROR = `Entre ${NAME_MIN} et ${NAME_MAX} caractères.`;

export interface ImportRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselects (and locks nothing) the target project. */
  defaultProjectId?: string;
  onImported?: (service: Service) => void;
  /** Opens directly on the configuration step of this repository. */
  defaultRepo?: GithubRepo | null;
}

/** Repo → branch → options flow that creates a GitHub service. */
export function ImportRepoDialog({
  open,
  onOpenChange,
  defaultProjectId,
  onImported,
  defaultRepo,
}: ImportRepoDialogProps) {
  const router = useRouter();

  function handleImported(service: Service) {
    onOpenChange(false);
    if (onImported) onImported(service);
    else router.push(routes.workspace(service.projectId, { service: service.id }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        {/* Radix unmounts the content when closed: the flow starts over on each opening. */}
        <ImportFlow
          defaultProjectId={defaultProjectId}
          defaultRepo={defaultRepo ?? null}
          onImported={handleImported}
        />
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ step }: { step: 1 | 2 }) {
  const steps = ["Choisir un dépôt", "Configurer"] as const;

  return (
    <ol aria-label="Étapes" className="flex items-center gap-2 text-sm">
      {steps.map((label, index) => {
        const number = index + 1;
        const done = step > number;
        const current = step === number;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
            {index > 0 ? <span aria-hidden className="h-px w-6 bg-border-strong sm:w-10" /> : null}
            <span
              className={cn(
                "tabular flex size-6 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                current && "border-brand-800 bg-brand-600/15 text-brand-400",
                done && "border-success/25 bg-success/10 text-success",
                !current && !done && "text-muted-foreground",
              )}
            >
              {done ? <Check aria-hidden className="size-3.5" /> : number}
            </span>
            <span className={cn(current ? "font-medium" : "text-muted-foreground")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

interface ImportFlowProps {
  defaultProjectId: string | undefined;
  defaultRepo: GithubRepo | null;
  onImported: (service: Service) => void;
}

function ImportFlow({ defaultProjectId, defaultRepo, onImported }: ImportFlowProps) {
  const connection = useGithubConnection();
  const [repo, setRepo] = useState<GithubRepo | null>(defaultRepo);
  const [connectOpen, setConnectOpen] = useState(false);

  const step = repo ? 2 : 1;
  const data = connection.data;

  let body: ReactNode;
  if (connection.isPending) {
    body = <RepoListSkeleton />;
  } else if (connection.isError || !data) {
    body = (
      <ErrorState
        compact
        title="Impossible de charger la connexion GitHub"
        error={connection.error}
        onRetry={() => {
          void connection.refetch();
        }}
      />
    );
  } else if (repo) {
    body = (
      <ConfigureStep
        key={repo.fullName}
        repo={repo}
        defaultProjectId={defaultProjectId}
        onBack={() => setRepo(null)}
        onImported={onImported}
      />
    );
  } else if (!data.connected) {
    body = (
      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-secondary ring-1 ring-border-strong">
            <GithubIcon aria-hidden className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">GitHub n’est pas connecté</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Connectez votre compte pour lister vos dépôts et les importer.
            </p>
          </div>
          <Button type="button" onClick={() => setConnectOpen(true)}>
            <GithubIcon data-icon="inline-start" />
            Connecter GitHub
          </Button>
        </div>
        {/* The simulator only knows its own repositories: public import needs the real backend. */}
        {API_MODE === "http" ? <PublicRepoForm onSelect={setRepo} /> : null}
      </div>
    );
  } else {
    body = <RepoStep connection={data} onSelect={setRepo} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>Importer un dépôt</DialogTitle>
        <DialogDescription>
          Choisissez un dépôt GitHub, puis configurez le service qui sera déployé.
        </DialogDescription>
      </DialogHeader>
      <StepIndicator step={step} />
      <motion.div key={`${step}-${data?.connected ? "ready" : "idle"}`} variants={fadeUp} initial="hidden" animate="visible">
        {body}
      </motion.div>
      <ConnectGithubDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}

const PUBLIC_REPO_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;

/** "owner/name" out of what was typed or pasted (a github.com URL is accepted). */
function parsePublicRepo(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  return PUBLIC_REPO_PATTERN.test(cleaned) ? cleaned : null;
}

/** Without a connected account a public repository can still be imported by its name. */
function PublicRepoForm({ onSelect }: { onSelect: (repo: GithubRepo) => void }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The dialog can sit inside another form (portals bubble through React).
    event.stopPropagation();
    const fullName = parsePublicRepo(value);
    if (!fullName) {
      setError("Saisissez un dépôt au format « propriétaire/nom ».");
      return;
    }
    const [owner, name] = fullName.split("/");
    onSelect({
      id: `public:${fullName}`,
      owner,
      name,
      fullName,
      description: "",
      private: false,
      language: null,
      framework: null,
      // Replaced by the default branch of the remote once its branches are read.
      defaultBranch: "main",
      stars: 0,
      pushedAt: new Date().toISOString(),
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-xl border bg-card px-4 py-3">
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>Importer un dépôt public</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={id}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder="propriétaire/dépôt"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(error) || undefined}
            className="font-mono text-[13px] sm:flex-1"
          />
          <Button type="submit" variant="outline">
            Continuer
          </Button>
        </div>
        <FieldDescription>
          Aucun jeton n’est nécessaire pour un dépôt public. Les dépôts privés demandent un compte connecté.
        </FieldDescription>
        <FieldError>{error}</FieldError>
      </Field>
    </form>
  );
}

function RepoListSkeleton() {
  return (
    <div aria-hidden className="divide-y overflow-hidden rounded-xl border bg-card">
      {Array.from({ length: 4 }, (_, index) => (
        <RepoPickerRowSkeleton key={index} />
      ))}
    </div>
  );
}

function RepoStep({
  connection,
  onSelect,
}: {
  connection: GithubConnection;
  onSelect: (repo: GithubRepo) => void;
}) {
  const browser = useRepoBrowser();
  const { repos, visible, byRepo } = browser;

  let list: ReactNode;
  if (repos.isPending) {
    list = <RepoListSkeleton />;
  } else if (repos.isError) {
    list = (
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
    list = (
      <EmptyState
        compact
        icon={SearchX}
        title={browser.hasFilters ? "Aucun dépôt ne correspond" : "Aucun dépôt accessible"}
        description={
          browser.hasFilters
            ? "Modifiez votre recherche pour élargir les résultats."
            : "Ce compte ne donne accès à aucun dépôt."
        }
      />
    );
  } else {
    list = (
      <ul className="max-h-[min(22rem,45dvh)] divide-y overflow-y-auto overscroll-contain rounded-xl border bg-card">
        {visible.map((repo) => (
          <li key={repo.id}>
            <RepoPickerRow repo={repo} deployed={byRepo.has(repo.fullName)} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput
          value={browser.search}
          onChange={browser.setSearch}
          placeholder="Rechercher un dépôt"
          className="sm:flex-1"
          autoFocus
        />
        <OwnerSelect connection={connection} value={browser.owner} onChange={browser.setOwner} />
      </div>
      <div aria-busy={repos.isFetching} className={cn("transition-opacity", browser.isUpdating && "opacity-70")}>
        {list}
      </div>
    </div>
  );
}

interface FormErrors {
  project?: string;
  name?: string;
  root?: string;
  branch?: string;
}

interface ConfigureStepProps {
  repo: GithubRepo;
  defaultProjectId: string | undefined;
  onBack: () => void;
  onImported: (service: Service) => void;
}

function normalizeRoot(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed === "") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function ConfigureStep({ repo, defaultProjectId, onBack, onImported }: ConfigureStepProps) {
  const router = useRouter();
  const ids = { branch: useId(), project: useId(), newProject: useId(), name: useId(), root: useId(), auto: useId() };

  const projects = useProjects();
  const branches = useGithubBranches(repo.fullName);
  const createProject = useCreateProject();
  const importRepo = useImportRepo();

  const [branch, setBranch] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [projectMode, setProjectMode] = useState<"existing" | "new">("existing");
  const [newProjectName, setNewProjectName] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [root, setRoot] = useState("/");
  const [builder, setBuilder] = useState<Builder>("nixpacks");
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});

  const busy = createProject.isPending || importRepo.isPending;
  // Without any project the only way forward is to create one.
  const creating = projectMode === "new" || (projects.isSuccess && projects.data.length === 0);
  // A repository typed by hand does not know its default branch: the remote does.
  const remoteDefault = branches.data?.find((item) => item.isDefault)?.name;
  const branchValue = branch ?? remoteDefault ?? repo.defaultBranch;
  const nameValue = name ?? repo.name;

  function clearError(key: keyof FormErrors) {
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const serviceName = nameValue.trim();
    const nextErrors: FormErrors = {};
    if (creating) {
      const length = newProjectName.trim().length;
      if (length < NAME_MIN || length > NAME_MAX) nextErrors.project = NAME_ERROR;
    } else if (!projectId) {
      nextErrors.project = "Choisissez un projet.";
    }
    if (serviceName.length < NAME_MIN || serviceName.length > NAME_MAX) nextErrors.name = NAME_ERROR;
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    let targetProjectId = projectId;
    if (creating) {
      try {
        const project = await createProject.mutateAsync({ name: newProjectName.trim() });
        targetProjectId = project.id;
        // Should the import fail, a retry must target this project, not create a twin.
        setProjectId(project.id);
        setProjectMode("existing");
      } catch (error) {
        if (isApiError(error) && error.field === "name") setErrors({ project: error.message });
        else toast.error(getErrorMessage(error));
        return;
      }
    }
    if (!targetProjectId) return;

    try {
      const service = await importRepo.mutateAsync({
        projectId: targetProjectId,
        repo: repo.fullName,
        branch: branchValue,
        rootDirectory: normalizeRoot(root),
        autoDeploy,
        name: serviceName,
        builder,
      });
      const deploymentId = service.latestDeploymentId;
      toast.success("Dépôt importé – déploiement lancé", {
        description: `${service.name} · ${repo.fullName}`,
        action: deploymentId
          ? { label: "Voir le déploiement", onClick: () => router.push(routes.deployment(deploymentId)) }
          : undefined,
      });
      onImported(service);
    } catch (error) {
      if (isApiError(error) && error.field === "name") setErrors({ name: error.message });
      else if (isApiError(error) && error.field === "rootDirectory") setErrors({ root: error.message });
      else if (isApiError(error) && error.field === "branch") setErrors({ branch: error.message });
      else toast.error(getErrorMessage(error));
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 gap-4">
      <div className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5">
        <GithubIcon aria-hidden className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm" title={repo.fullName}>
          <span className="hidden text-muted-foreground sm:inline">{repo.owner}/</span>
          <span className="font-medium">{repo.name}</span>
        </span>
        {repo.private ? <Badge variant="outline">Privé</Badge> : null}
        <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={busy}>
          Changer
        </Button>
      </div>

      <Field data-invalid={errors.branch ? true : undefined}>
        <FieldLabel htmlFor={ids.branch}>Branche</FieldLabel>
        {branches.isPending ? (
          <Skeleton className="h-9 w-full rounded-lg" />
        ) : branches.isError ? (
          <BranchesErrorRow
            onRetry={() => {
              void branches.refetch();
            }}
          />
        ) : (
          <BranchSelect
            id={ids.branch}
            branches={branches.data}
            value={branchValue}
            onChange={(next) => {
              setBranch(next);
              clearError("branch");
            }}
            detailed
            disabled={busy}
            invalid={Boolean(errors.branch)}
          />
        )}
        <FieldDescription>La branche par défaut est présélectionnée.</FieldDescription>
        <FieldError>{errors.branch}</FieldError>
      </Field>

      <Field>
        <FieldLabel htmlFor={creating ? ids.newProject : ids.project}>Projet</FieldLabel>
        {creating ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id={ids.newProject}
              value={newProjectName}
              onChange={(event) => {
                setNewProjectName(event.target.value);
                clearError("project");
              }}
              placeholder="Nom du nouveau projet"
              maxLength={NAME_MAX}
              autoComplete="off"
              disabled={busy}
              aria-invalid={Boolean(errors.project) || undefined}
              className="sm:flex-1"
            />
            {projects.isSuccess && projects.data.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setProjectMode("existing");
                  clearError("project");
                }}
              >
                Choisir un projet existant
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ProjectSelect
              id={ids.project}
              value={projectId}
              onChange={(next) => {
                setProjectId(next);
                clearError("project");
              }}
              disabled={busy}
              className="w-full sm:flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setProjectMode("new");
                clearError("project");
              }}
            >
              <Plus data-icon="inline-start" />
              Nouveau projet
            </Button>
          </div>
        )}
        <FieldError>{errors.project}</FieldError>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={ids.name}>Nom du service</FieldLabel>
          <Input
            id={ids.name}
            value={nameValue}
            onChange={(event) => {
              setName(event.target.value);
              clearError("name");
            }}
            maxLength={NAME_MAX}
            autoComplete="off"
            disabled={busy}
            aria-invalid={Boolean(errors.name) || undefined}
          />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field data-invalid={errors.root ? true : undefined}>
          <FieldLabel htmlFor={ids.root}>Répertoire racine</FieldLabel>
          <Input
            id={ids.root}
            value={root}
            onChange={(event) => {
              setRoot(event.target.value);
              clearError("root");
            }}
            onBlur={() => setRoot((current) => normalizeRoot(current))}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            aria-invalid={Boolean(errors.root) || undefined}
            className="font-mono text-[13px]"
          />
          <FieldError>{errors.root}</FieldError>
        </Field>
      </div>

      <Field>
        <FieldLabel>Builder</FieldLabel>
        <SegmentedControl
          value={builder}
          onValueChange={setBuilder}
          options={BUILDER_OPTIONS}
          label="Builder"
          disabled={busy}
          className="w-full sm:w-64"
        />
        <FieldDescription>
          Nixpacks détecte le langage et construit l’image. Choisissez Dockerfile pour utiliser
          celui du dépôt.
        </FieldDescription>
      </Field>

      <div className="flex items-start justify-between gap-4 rounded-lg bg-secondary px-3 py-2.5">
        <div className="min-w-0">
          <FieldLabel htmlFor={ids.auto}>Déployer automatiquement à chaque push</FieldLabel>
          <FieldDescription>
            Un push sur la branche {branchValue} lance un nouveau déploiement.
          </FieldDescription>
        </div>
        <Switch
          id={ids.auto}
          checked={autoDeploy}
          onCheckedChange={setAutoDeploy}
          disabled={busy}
          className="mt-0.5"
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          <ArrowLeft data-icon="inline-start" />
          Retour
        </Button>
        <Button type="submit" disabled={busy || branches.isError}>
          {busy ? <Spinner data-icon="inline-start" aria-label="Import en cours" /> : <Rocket data-icon="inline-start" />}
          Importer et déployer
        </Button>
      </DialogFooter>
    </form>
  );
}
