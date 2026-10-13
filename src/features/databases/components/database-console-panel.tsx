"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Boxes, CornerDownLeft, Eraser, Info, SquareTerminal } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ServiceSelect } from "@/components/shared/service-select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { API_MODE } from "@/lib/api";
import { getErrorMessage } from "@/lib/api/contract";
import { formatDuration } from "@/lib/format";
import { invalidateEntities, useConnections, useDatabaseCommand, useServices, useStartDatabaseCommand } from "@/lib/queries";
import type { CommandRun, Database, Service, ServiceConnection, ServiceType } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DatabaseGate } from "./database-gate";

const MAX_ENTRIES = 50;
const EXAMPLES = ["npx prisma migrate deploy", "npm run", "node -v", "ls -la"];
/** Kinds of service that have application code to run commands in. */
const APPLICATION_TYPES: ServiceType[] = ["github", "docker"];

interface Entry {
  id: number;
  /** Name of the service the command ran in. */
  serviceName: string;
  command: string;
  /** Null until the server has started the command. */
  run: CommandRun | null;
  /** The command could not be started at all (service offline, refused…). */
  error: string | null;
}

function ConsoleSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3">
      <p role="status" className="sr-only">
        Chargement de la console…
      </p>
      <Skeleton className="h-96 w-full rounded-xl" />
      <Skeleton className="h-4 w-full max-w-md" />
    </div>
  );
}

function Outcome({ run }: { run: CommandRun }) {
  const failed = run.exitCode !== 0;
  if (!failed && !run.truncated) return null;
  return (
    <p className={cn("font-sans text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
      {run.timedOut
        ? "Délai de 15 min dépassé : la console n’attend plus cette commande, qui peut encore tourner dans le conteneur."
        : failed
          ? `Code de sortie ${run.exitCode} · ${formatDuration(run.durationMs)}`
          : null}
      {run.truncated ? `${failed ? " · " : ""}Sortie tronquée : seule la fin est affichée.` : null}
    </p>
  );
}

/** Output of a started command, refreshed while it runs. */
function RunView({ databaseId, initial }: { databaseId: string; initial: CommandRun }) {
  const query = useDatabaseCommand(databaseId, initial);
  const run = query.data ?? initial;
  const lost = query.isError;
  const failed = !run.running && run.exitCode !== 0;
  return (
    <>
      {run.stdout ? (
        <pre className="font-mono break-words whitespace-pre-wrap text-foreground/85">{run.stdout.trimEnd()}</pre>
      ) : null}
      {run.stderr ? (
        <pre
          className={cn(
            "font-mono break-words whitespace-pre-wrap",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {run.stderr.trimEnd()}
        </pre>
      ) : null}
      {run.running && !lost ? (
        <p className="flex items-center gap-2 font-sans text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          <span className="tabular">En cours… {formatDuration(run.durationMs)}</span>
        </p>
      ) : null}
      {lost ? (
        <p role="alert" className="font-sans text-xs text-destructive">
          Suivi de la commande perdu ({getErrorMessage(query.error)}) : elle peut encore tourner dans le conteneur.
        </p>
      ) : null}
      {!run.running ? <Outcome run={run} /> : null}
    </>
  );
}

function EntryView({ databaseId, entry }: { databaseId: string; entry: Entry }) {
  return (
    <div className="space-y-1">
      <p className="flex gap-2 break-all">
        <span className="shrink-0 text-brand-400 select-none">
          <span className="sr-only">Dans </span>
          {entry.serviceName} <span aria-hidden="true">$</span>
        </span>
        <span className="min-w-0 whitespace-pre-wrap text-foreground">{entry.command}</span>
      </p>
      {entry.run === null && entry.error === null ? (
        <p className="flex items-center gap-2 font-sans text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          Lancement…
        </p>
      ) : null}
      {entry.run ? <RunView databaseId={databaseId} initial={entry.run} /> : null}
      {entry.error !== null ? (
        <p role="alert" className="font-sans text-xs text-destructive">
          {entry.error}
        </p>
      ) : null}
    </div>
  );
}

/** The first application linked to the database on the canvas, otherwise the first application of the project. */
function defaultTarget(database: Database, apps: Service[], connections: ServiceConnection[]): Service | undefined {
  const linkedIds = connections
    .filter((link) => link.fromServiceId === database.serviceId || link.toServiceId === database.serviceId)
    .map((link) => (link.fromServiceId === database.serviceId ? link.toServiceId : link.fromServiceId));
  return linkedIds.map((id) => apps.find((app) => app.id === id)).find((app) => app) ?? apps[0];
}

function CommandConsole({ database, apps, initialTarget }: { database: Database; apps: Service[]; initialTarget: Service }) {
  const start = useStartDatabaseCommand();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  /** Position in the recalled commands, from the most recent; -1 = the draft being typed. */
  const [recall, setRecall] = useState(-1);
  const [chosenId, setChosenId] = useState<string | null>(null);
  // A chosen service that was deleted since falls back to the default one.
  const target = apps.find((app) => app.id === chosenId) ?? initialTarget;

  // The last command is followed here too (same query as its <RunView>): the prompt waits for it.
  const lastRun = entries.at(-1)?.run ?? null;
  const active = useDatabaseCommand(database.id, lastRun);
  const activeRun = active.data ?? lastRun;
  const running = start.isPending || (activeRun !== null && activeRun.running && !active.isError);
  const commands = entries.map((entry) => entry.command).reverse();
  const outputLength = (activeRun?.stdout.length ?? 0) + (activeRun?.stderr.length ?? 0);

  // The newest output stays in view.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries, outputLength, running]);

  // A finished command (a migration…) may have changed anything in the database.
  const finishedId = activeRun !== null && !activeRun.running ? activeRun.id : null;
  useEffect(() => {
    if (finishedId === null) return;
    void invalidateEntities(queryClient, ["databases"]);
    inputRef.current?.focus();
  }, [finishedId, queryClient]);

  function settle(id: number, patch: Pick<Entry, "run" | "error">) {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  function execute(line: string) {
    const command = line.trim();
    if (command === "" || running) return;
    nextId.current += 1;
    const id = nextId.current;
    setEntries((current) =>
      [...current, { id, serviceName: target.name, command, run: null, error: null }].slice(-MAX_ENTRIES),
    );
    setDraft("");
    setRecall(-1);
    start.mutate(
      { id: database.id, command, serviceId: target.id },
      {
        onSuccess: (run) => settle(id, { run, error: null }),
        onError: (error) => {
          settle(id, { run: null, error: getErrorMessage(error) });
          inputRef.current?.focus();
        },
      },
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    execute(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const next = event.key === "ArrowUp" ? Math.min(recall + 1, commands.length - 1) : Math.max(recall - 1, -1);
    if (next === recall) return;
    event.preventDefault();
    setRecall(next);
    setDraft(next === -1 ? "" : commands[next]);
  }

  function load(example: string) {
    setDraft(example);
    setRecall(-1);
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <SquareTerminal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="shrink-0 text-xs text-muted-foreground">
            Exécuter dans
          </span>
          <ServiceSelect
            projectId={database.projectId}
            types={APPLICATION_TYPES}
            value={target.id}
            onChange={setChosenId}
            disabled={running}
            aria-label="Service dans lequel exécuter les commandes"
            className="h-8 w-44 min-w-0"
          />
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            disabled={entries.length === 0 || running}
            onClick={() => {
              setEntries([]);
              inputRef.current?.focus();
            }}
          >
            <Eraser data-icon="inline-start" />
            Effacer
          </Button>
        </div>

        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-label="Sortie de la console"
          tabIndex={0}
          className="h-96 space-y-3 overflow-y-auto bg-background p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset sm:text-[13px]"
        >
          {entries.length === 0 ? (
            <p className="font-sans text-sm text-muted-foreground">
              Saisissez une commande ci-dessous, par exemple <span className="font-mono text-[13px]">{EXAMPLES[0]}</span>.
            </p>
          ) : (
            entries.map((entry) => <EntryView key={entry.id} databaseId={database.id} entry={entry} />)
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t px-3 py-2">
          <label htmlFor={`console-${database.id}`} className="sr-only">
            Ligne de commande
          </label>
          <span aria-hidden="true" className="max-w-32 shrink-0 truncate font-mono text-[13px] text-brand-400 select-none">
            {target.name} $
          </span>
          <input
            id={`console-${database.id}`}
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setRecall(-1);
            }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            placeholder="npx prisma migrate deploy"
            className="h-8 min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground/70"
          />
          <Button type="submit" size="sm" disabled={draft.trim() === "" || running}>
            {running ? <Spinner data-icon="inline-start" /> : <CornerDownLeft data-icon="inline-start" />}
            Exécuter
          </Button>
        </form>
      </div>

      <ul aria-label="Exemples de commandes" className="flex min-w-0 flex-wrap gap-1.5">
        {EXAMPLES.map((example) => (
          <li key={example} className="min-w-0">
            <button
              type="button"
              onClick={() => load(example)}
              title={example}
              className="max-w-full truncate rounded-md border bg-secondary px-2 py-1 text-left font-mono text-xs text-muted-foreground transition-colors outline-none hover:border-border-strong hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {example}
            </button>
          </li>
        ))}
      </ul>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {API_MODE === "mock"
            ? "Le simulateur ne connaît que quelques commandes (tapez help)."
            : `Les commandes s’exécutent dans le conteneur du service « ${target.name} », là où se trouvent le code de l’application et ses variables (DATABASE_URL…) : idéal pour une migration.`}{" "}
          Pas de session interactive, rien n’est conservé d’une ligne à l’autre. La sortie s’affiche au fur et à mesure ; une commande à la fois, 15 min au maximum.
        </span>
      </p>
    </div>
  );
}

/** Resolves the application services of the project before showing the console. */
function ConsoleTargets({ database }: { database: Database }) {
  const services = useServices({ projectId: database.projectId });
  const connections = useConnections(database.projectId);

  if (services.isError) {
    return (
      <ErrorState
        compact
        title="Impossible de charger les services du projet"
        error={services.error}
        onRetry={() => void services.refetch()}
      />
    );
  }
  if (!services.data || connections.isPending) return <ConsoleSkeleton />;

  const apps = services.data.filter((service) => APPLICATION_TYPES.includes(service.source.type));
  const initialTarget = defaultTarget(database, apps, connections.data ?? []);
  if (!initialTarget) {
    return (
      <EmptyState
        compact
        icon={Boxes}
        title="Aucun service applicatif dans ce projet"
        description="La console exécute les commandes de votre application (migrations, scripts npm…) dans son conteneur. Ajoutez un service GitHub ou Docker au projet pour l’utiliser."
      />
    );
  }
  return <CommandConsole database={database} apps={apps} initialTarget={initialTarget} />;
}

/**
 * Command console of a database: application command lines (migrations, npm
 * scripts…) run inside the container of an application service of the project.
 */
export function DatabaseConsolePanel({ databaseId }: { databaseId: string }) {
  return (
    <DatabaseGate databaseId={databaseId} skeleton={<ConsoleSkeleton />}>
      {(database) => <ConsoleTargets database={database} />}
    </DatabaseGate>
  );
}
