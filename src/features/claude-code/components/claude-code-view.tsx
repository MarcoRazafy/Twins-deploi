"use client";

import { Folder, History, SquarePen, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useClaudeCode } from "../hooks/use-claude-code";
import { Composer } from "./composer";
import { ConversationList } from "./conversation-list";
import { MessageList } from "./message-list";

const SUGGESTIONS = [
  "Quel est l’état des services et des conteneurs sur ce serveur ?",
  "Quels déploiements ont échoué récemment, et pourquoi ?",
  "Combien d’espace disque reste-t-il, et qu’est-ce qui en prend le plus ?",
] as const;

interface WelcomeProps {
  cwd: string;
  onCwdChange: (value: string) => void;
  onSuggestion: (text: string) => void;
  disabled: boolean;
}

function Welcome({ cwd, onCwdChange, onSuggestion, disabled }: WelcomeProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
        <div>
          <h2 className="text-xl font-medium">Que voulez-vous faire ?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Claude Code travaille directement sur ce serveur : il lit et modifie les fichiers, lance des commandes
            et vous répond ici, comme dans le terminal.
          </p>
        </div>

        <div className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            Il agit avec les droits <strong className="font-semibold">root</strong> et n’attend aucune
            confirmation avant d’exécuter une commande ou de modifier un fichier. Relisez votre demande avant de
            l’envoyer.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="claude-cwd">Dossier de travail</Label>
          <div className="relative">
            <Folder
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="claude-cwd"
              value={cwd}
              onChange={(event) => onCwdChange(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="pl-8 font-mono text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Chemin absolu sur le serveur. Il reste le même pendant toute la conversation.
          </p>
        </div>

        <div className="flex flex-col items-start gap-2" role="group" aria-label="Suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={disabled}
              onClick={() => onSuggestion(suggestion)}
              className="rounded-full border border-border-strong bg-background px-3 py-1.5 text-left text-xs text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Full-height chat with Claude Code: history on the left, conversation and composer on the right. */
export function ClaudeCodeView() {
  const claude = useClaudeCode();
  const { active, conversations, runningId, status, statusError } = claude;
  const [draft, setDraft] = useState("");
  // Null = follow the proposed directory until the user types another one.
  const [cwdDraft, setCwdDraft] = useState<string | null>(null);
  const cwd = cwdDraft ?? claude.defaultCwd;

  const running = active !== null && runningId === active.id;
  const unavailable = statusError !== null || status?.available === false;
  // One turn at a time: a conversation waits while another one is running.
  const blocked = unavailable || (runningId !== null && !running);

  function send(text: string) {
    if (text.trim() === "" || blocked || running) return;
    claude.send(text, cwd);
    setDraft("");
  }

  function startNew() {
    claude.select(null);
    setDraft("");
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 flex-col border-r lg:flex" aria-label="Conversations">
        <div className="shrink-0 p-3">
          <Button type="button" variant="outline" className="w-full justify-start" onClick={startNew}>
            <SquarePen />
            Nouvelle conversation
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <ConversationList
            conversations={conversations}
            activeId={active?.id ?? null}
            runningId={runningId}
            onSelect={claude.select}
            onRemove={claude.remove}
          />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Claude Code">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium">{active?.title ?? "Nouvelle conversation"}</h1>
            {active ? <p className="truncate font-mono text-xs text-muted-foreground">{active.cwd}</p> : null}
          </div>
          <div className="flex items-center gap-1 lg:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Conversations">
                  <History />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
                <DropdownMenuLabel>Conversations</DropdownMenuLabel>
                {conversations.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">Aucune conversation pour l’instant.</p>
                ) : (
                  conversations.map((conversation) => (
                    <DropdownMenuItem key={conversation.id} onSelect={() => claude.select(conversation.id)}>
                      <span className="truncate">{conversation.title}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" variant="ghost" size="icon" aria-label="Nouvelle conversation" onClick={startNew}>
              <SquarePen />
            </Button>
          </div>
        </header>

        {unavailable ? (
          <p
            role="alert"
            className="mx-4 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            {statusError ??
              "Claude Code n’est pas activé sur ce serveur : exécutez sudo bash scripts/server/setup.sh --claude-code, puis redémarrez la plateforme."}
          </p>
        ) : null}

        {active ? (
          <MessageList key={active.id} items={active.items} running={running} />
        ) : (
          <Welcome cwd={cwd} onCwdChange={setCwdDraft} onSuggestion={send} disabled={blocked} />
        )}

        <Composer
          key={active?.id ?? "new"}
          value={draft}
          onChange={setDraft}
          onSubmit={() => send(draft)}
          onStop={claude.stop}
          running={running}
          disabled={blocked}
          placeholder={
            runningId !== null && !running
              ? "Claude Code travaille dans une autre conversation…"
              : active
                ? "Répondre à Claude Code…"
                : "Décrivez la tâche à confier à Claude Code…"
          }
        />
      </section>
    </div>
  );
}
