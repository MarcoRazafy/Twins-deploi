"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { CircleAlert, CircleCheck, CircleX, History, Info, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useHotkeyLabel } from "@/hooks/use-hotkey";
import { getErrorMessage } from "@/lib/api/contract";
import { formatNumber, formatTime, pluralize } from "@/lib/format";
import { useDatabaseTables, useRunDatabaseQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { ResultGrid } from "./result-grid";

const MAX_HISTORY = 8;
const MAX_TABLE_CHIPS = 2;

interface HistoryEntry {
  id: number;
  sql: string;
  ok: boolean;
  at: number;
}

/** Example statements built from what the simulator understands and the real table names. */
function buildExamples(tableNames: string[]): string[] {
  const examples: string[] = [];
  for (const name of tableNames.slice(0, MAX_TABLE_CHIPS)) {
    examples.push(`SELECT * FROM ${name} LIMIT 10;`);
  }
  if (tableNames[0]) examples.push(`SELECT COUNT(*) FROM ${tableNames[0]};`);
  examples.push("SELECT version();", "SELECT now();");
  examples.push("SELECT table_name FROM information_schema.tables;");
  return examples;
}

/** Read-only SQL console: editor, example chips, result grid and session history. */
export function SqlConsole({ databaseId }: { databaseId: string }) {
  const tables = useDatabaseTables(databaseId);
  const run = useRunDatabaseQuery();
  const shortcut = useHotkeyLabel("mod+enter");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const historyId = useRef(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const tableNames = (tables.data ?? []).map((table) => table.name);
  const examples = buildExamples(tableNames);
  const sql = draft ?? examples[0] ?? "SELECT version();";
  const canRun = sql.trim().length > 0 && !run.isPending;

  function execute() {
    if (!canRun) return;
    const statement = sql.trim();
    const record = (ok: boolean) => {
      historyId.current += 1;
      const entry: HistoryEntry = { id: historyId.current, sql: statement, ok, at: Date.now() };
      setHistory((current) =>
        [entry, ...current.filter((item) => item.sql !== statement)].slice(0, MAX_HISTORY),
      );
    };
    run.mutate(
      { id: databaseId, sql: statement },
      { onSuccess: () => record(true), onError: () => record(false) },
    );
  }

  function load(statement: string) {
    setDraft(statement);
    editorRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      execute();
    }
  }

  const result = run.data;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor={`sql-${databaseId}`} className="sr-only">
          Requête SQL
        </label>
        <Textarea
          id={`sql-${databaseId}`}
          ref={editorRef}
          value={sql}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={5}
          className="min-h-32 resize-y font-mono text-[13px] md:text-[13px]"
          placeholder="SELECT * FROM table LIMIT 10;"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <ul aria-label="Exemples de requêtes" className="flex min-w-0 flex-wrap gap-1.5">
            {examples.map((example) => (
              <li key={example} className="min-w-0">
                <button
                  type="button"
                  onClick={() => load(example)}
                  title={example}
                  className="max-w-full truncate rounded-md border bg-secondary px-2 py-1 text-left font-mono text-xs text-muted-foreground transition-colors outline-none hover:border-border-strong hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {example.replace(/;$/, "")}
                </button>
              </li>
            ))}
          </ul>
          <Button className="shrink-0 max-sm:h-10 max-sm:w-full" disabled={!canRun} onClick={execute}>
            {run.isPending ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            Exécuter
          </Button>
        </div>

        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          Le simulateur ne comprend que des requêtes SELECT simples. Exécution :
          <span className="inline-flex gap-1">
            {shortcut.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        </p>
      </div>

      <div aria-live="polite" className="space-y-2">
        {run.isError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">Erreur de requête</p>
              <p className="font-mono text-[13px] break-words whitespace-pre-wrap">
                {getErrorMessage(run.error)}
              </p>
            </div>
          </div>
        ) : null}

        {result ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono">
                {result.command}
              </Badge>
              <span className="tabular">
                {pluralize(result.rowCount, "ligne")} · {formatNumber(result.durationMs)}&nbsp;ms
              </span>
            </div>
            <ResultGrid
              columns={result.columns.map((name) => ({ name }))}
              rows={result.rows}
              label="Résultat de la requête"
              emptyMessage="La requête n’a renvoyé aucune ligne."
              maxHeight="24rem"
            />
          </>
        ) : null}
      </div>

      {history.length > 0 ? (
        <section aria-label="Historique de la session" className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <History className="size-3.5" aria-hidden="true" />
            Historique de la session
          </h3>
          <ul className="divide-y rounded-lg border bg-card">
            {history.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => load(entry.sql)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40"
                >
                  {entry.ok ? (
                    <CircleCheck className="size-3.5 shrink-0 text-success" aria-label="Réussie" role="img" />
                  ) : (
                    <CircleX className="size-3.5 shrink-0 text-destructive" aria-label="En erreur" role="img" />
                  )}
                  <span
                    title={entry.sql}
                    className={cn("min-w-0 flex-1 truncate font-mono text-xs")}
                  >
                    {entry.sql}
                  </span>
                  <span className="tabular shrink-0 text-xs text-muted-foreground">
                    {formatTime(entry.at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
