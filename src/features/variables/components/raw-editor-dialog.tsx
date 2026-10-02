"use client";

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage } from "@/lib/api/contract";
import { pluralize } from "@/lib/format";
import { TONE_CLASSES, type StatusTone } from "@/lib/status";
import type { EnvVariable } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { VariableActions } from "../hooks/use-variable-actions";
import {
  diffEnv,
  parseEnv,
  serializeEnv,
  type EnvDiff,
  type EnvIssue,
  type ParsedEnv,
} from "../lib/env";

const MAX_LISTED_ISSUES = 20;

function IssueList({ issues }: { issues: readonly EnvIssue[] }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium text-destructive">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        {`${pluralize(issues.length, "ligne")} ${issues.length > 1 ? "invalides" : "invalide"} : corrigez${issues.length > 1 ? "-les" : "-la"} pour continuer`}
      </p>
      <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
        {issues.slice(0, MAX_LISTED_ISSUES).map((issue) => (
          <li key={`${issue.line}-${issue.message}`} className="flex gap-2">
            <span className="shrink-0 font-mono text-xs leading-5 text-destructive tabular">
              Ligne {issue.line}
            </span>
            <span className="text-muted-foreground">{issue.message}</span>
          </li>
        ))}
        {issues.length > MAX_LISTED_ISSUES ? (
          <li className="text-xs text-muted-foreground">
            et {issues.length - MAX_LISTED_ISSUES} autres lignes
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function DiffGroup({
  tone,
  title,
  keys,
}: {
  tone: StatusTone;
  title: string;
  keys: readonly string[];
}) {
  if (keys.length === 0) return null;
  const classes = TONE_CLASSES[tone];

  return (
    <section className={cn("rounded-lg border p-3", classes.bg, classes.border)}>
      <h3 className={cn("text-sm font-medium", classes.text)}>{title}</h3>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {keys.map((key) => (
          <li key={key}>
            <code className="rounded-md border bg-card px-1.5 py-0.5 font-mono text-xs">{key}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface RawEditorBodyProps {
  variables: readonly EnvVariable[];
  scopeLabel: string;
  actions: VariableActions;
  onClose: () => void;
}

// Rendered inside the dialog content, which unmounts on close: the text starts
// from the current variables every time the dialog opens.
function RawEditorBody({ variables, scopeLabel, actions, onClose }: RawEditorBodyProps) {
  const [text, setText] = useState(() => serializeEnv(variables));
  const [parsed, setParsed] = useState<ParsedEnv | null>(null);
  const [issues, setIssues] = useState<EnvIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Frozen once saving starts: the refetch that follows the write must not rewrite the summary.
  const [frozenDiff, setFrozenDiff] = useState<EnvDiff | null>(null);

  const reviewing = parsed !== null;
  // Computed against the live variables, so the summary stays right if they change meanwhile.
  const liveDiff = useMemo(
    () => (parsed ? diffEnv(variables, parsed.entries) : null),
    [parsed, variables],
  );
  const diff = frozenDiff ?? liveDiff;
  const total = diff ? diff.added.length + diff.changed.length + diff.removed.length : 0;

  function handleApply() {
    const result = parseEnv(text);
    if (result.issues.length > 0) {
      setIssues(result.issues);
      return;
    }
    setIssues([]);
    setSaveError(null);
    setParsed(result);
  }

  async function handleSave() {
    if (!liveDiff || saving) return;
    setSaving(true);
    setSaveError(null);
    setFrozenDiff(liveDiff);
    try {
      await actions.applyEntries(liveDiff.entries, liveDiff);
      onClose();
    } catch (error) {
      setFrozenDiff(null);
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{reviewing ? "Vérifier les changements" : "Éditeur brut"}</DialogTitle>
        <DialogDescription>
          {reviewing
            ? `Voici ce qui changera pour les variables ${scopeLabel} une fois le texte appliqué.`
            : `Modifiez toutes les variables ${scopeLabel} au format .env, une par ligne.`}
        </DialogDescription>
      </DialogHeader>

      {reviewing && diff ? (
        <div className="grid max-h-[50vh] gap-3 overflow-y-auto">
          {total === 0 ? (
            <p className="rounded-lg border bg-secondary/40 p-4 text-sm text-muted-foreground">
              Aucun changement : le texte est identique aux variables actuelles.
            </p>
          ) : null}
          <DiffGroup tone="success" title={pluralize(diff.added.length, "ajout")} keys={diff.added} />
          <DiffGroup
            tone="info"
            title={pluralize(diff.changed.length, "modification")}
            keys={diff.changed}
          />
          <DiffGroup
            tone="danger"
            title={`${pluralize(diff.removed.length, "suppression")} (absentes du texte)`}
            keys={diff.removed}
          />
          {diff.unchanged > 0 ? (
            <p className="text-xs text-muted-foreground">
              {diff.unchanged} {diff.unchanged > 1 ? "variables inchangées" : "variable inchangée"}
            </p>
          ) : null}
          {parsed.duplicates.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Clés en double fusionnées (la dernière valeur est retenue) :{" "}
              <span className="font-mono">{parsed.duplicates.join(", ")}</span>
            </p>
          ) : null}
          {saveError ? (
            <p role="alert" className="text-sm text-destructive">
              {saveError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <Textarea
            value={text}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            aria-label="Contenu .env"
            aria-invalid={issues.length > 0}
            placeholder="NOM=valeur"
            className="h-72 resize-none overflow-auto font-mono leading-6 field-sizing-fixed! whitespace-pre md:text-[13px]"
            onChange={(event) => {
              setText(event.target.value);
              if (issues.length > 0) setIssues([]);
            }}
          />
          {issues.length > 0 ? (
            <IssueList issues={issues} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Les valeurs, secrets compris, sont affichées en clair. Les lignes qui commencent par #
              sont ignorées, les valeurs peuvent être entre guillemets. Une variable absente du
              texte sera supprimée.
            </p>
          )}
        </div>
      )}

      <DialogFooter>
        {reviewing ? (
          <>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setParsed(null)}>
              Retour
            </Button>
            <Button type="button" disabled={saving || total === 0} onClick={handleSave}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              Enregistrer
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="button" onClick={handleApply}>
              Appliquer
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

export interface RawEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variables: readonly EnvVariable[];
  /** Completes "les variables …": "du service api" or "partagées du projet". */
  scopeLabel: string;
  actions: VariableActions;
}

/**
 * The scope as KEY=value text. "Appliquer" parses it (invalid lines are
 * listed with their number and block the save), then a diff summary is shown
 * before anything is written.
 */
export function RawEditorDialog({
  open,
  onOpenChange,
  variables,
  scopeLabel,
  actions,
}: RawEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <RawEditorBody
          variables={variables}
          scopeLabel={scopeLabel}
          actions={actions}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
