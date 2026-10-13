"use client";

import { Check, ChevronRight, CircleAlert, CircleSlash } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { ChatItem } from "../lib/conversation-store";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** Names shown instead of Claude Code's tool identifiers. */
const TOOL_LABELS: Record<string, string> = {
  Bash: "Commande",
  Read: "Lecture",
  Write: "Écriture",
  Edit: "Modification",
  NotebookEdit: "Modification",
  Glob: "Recherche de fichiers",
  Grep: "Recherche",
  WebFetch: "Page web",
  WebSearch: "Recherche web",
  Task: "Sous-agent",
  Agent: "Sous-agent",
  TodoWrite: "Liste de tâches",
};

function StateIcon({ item, running }: { item: ToolItem; running: boolean }) {
  if (item.output === null) {
    // No answer and nothing running any more: the turn was stopped during this call.
    return running ? (
      <Spinner className="size-3.5 text-muted-foreground" aria-label="En cours" />
    ) : (
      <CircleSlash className="size-3.5 text-muted-foreground" aria-label="Interrompu" />
    );
  }
  return item.isError ? (
    <CircleAlert className="size-3.5 text-destructive" aria-label="Échec" />
  ) : (
    <Check className="size-3.5 text-success" aria-label="Terminé" />
  );
}

const PRE = "overflow-auto rounded-md bg-background/60 p-2.5 font-mono text-xs whitespace-pre-wrap break-words";

/** One tool call of Claude Code: a one-line summary that opens on its input and output. */
export function ToolCall({ item, running }: { item: ToolItem; running: boolean }) {
  const summary = item.input.split("\n")[0];

  return (
    <Collapsible className="group/tool rounded-lg border bg-card text-sm">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-90"
        />
        <span className="shrink-0 font-medium">{TOOL_LABELS[item.name] ?? item.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{summary}</span>
        <StateIcon item={item} running={running} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t px-3 py-2.5">
        {item.input !== "" ? <pre className={cn(PRE, "max-h-48")}>{item.input}</pre> : null}
        {item.output !== null && item.output !== "" ? (
          <pre className={cn(PRE, "max-h-72", item.isError && "text-destructive")}>{item.output}</pre>
        ) : null}
        {item.output === "" ? <p className="text-xs text-muted-foreground">Aucune sortie.</p> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
