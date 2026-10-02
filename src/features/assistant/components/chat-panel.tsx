"use client";

import { SquarePen, SendHorizontal, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fadeUp } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { AssistantChat } from "../hooks/use-assistant-chat";
import { MAX_CONTENT_CHARS } from "../lib/request";
import { Markdown } from "./markdown";

const SUGGESTIONS = [
  "Comment déployer un dépôt GitHub ?",
  "Comment créer une base PostgreSQL ?",
  "Comment ajouter un domaine ?",
  "Comment ajouter une variable ?",
] as const;

const WELCOME =
  "Bonjour, je suis l’assistant TwinsDeploi. Je vous guide pas à pas dans toutes les fonctionnalités de la plateforme : projets, workspace, GitHub, Docker, PostgreSQL, variables, domaines, déploiements et réglages.";

export const PANEL_ID = "assistant-panel";

function Bubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div
        data-role={role}
        className={cn(
          "max-w-[88%] rounded-xl px-3 py-2 text-sm leading-relaxed",
          role === "user"
            ? "rounded-br-sm bg-primary whitespace-pre-wrap text-primary-foreground"
            : "rounded-bl-sm bg-secondary text-foreground",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start" role="status">
      <div className="flex items-center gap-1 rounded-xl rounded-bl-sm bg-secondary px-3.5 py-3">
        <span className="sr-only">L’assistant écrit…</span>
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
            style={{ animationDelay: `${dot * 180}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

interface ChatPanelProps {
  chat: AssistantChat;
  draft: string;
  onDraftChange: (value: string) => void;
  onClose: () => void;
}

export function ChatPanel({ chat, draft, onDraftChange, onClose }: ChatPanelProps) {
  const { turns, sending, error, send, retry, reset } = chat;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Focus the question field when the panel opens.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Keep the latest message in view; a long answer opens at its first line, not its last.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const last = turns[turns.length - 1];
    if (last?.role === "assistant" && !sending && !error) {
      const bubbles = element.querySelectorAll<HTMLElement>("[data-role='assistant']");
      const bubble = bubbles[bubbles.length - 1];
      if (bubble && bubble.offsetHeight > element.clientHeight - 24) {
        const top =
          bubble.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
        element.scrollTop = Math.max(0, top - 12);
        return;
      }
    }
    element.scrollTop = element.scrollHeight;
  }, [turns, sending, error]);

  function submit(text: string) {
    if (text.trim() === "" || sending) return;
    send(text);
    onDraftChange("");
    inputRef.current?.focus({ preventScroll: true });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(draft);
    }
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.stopPropagation();
      onClose();
    }
  }

  function handleReset() {
    reset();
    onDraftChange("");
    inputRef.current?.focus({ preventScroll: true });
  }

  const empty = turns.length === 0;

  return (
    <motion.section
      id={PANEL_ID}
      role="dialog"
      aria-label="Assistant"
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      onKeyDown={handlePanelKeyDown}
      className="fixed inset-0 z-40 flex flex-col bg-card pb-[env(safe-area-inset-bottom)] sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[560px] sm:max-h-[calc(100dvh-2rem)] sm:w-[380px] sm:rounded-xl sm:border sm:border-border-strong sm:pb-0 sm:shadow-xl sm:shadow-black/40"
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-tight font-medium">Assistant</h2>
          <p className="truncate text-xs text-muted-foreground">Guide de la plateforme</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Nouvelle conversation"
              onClick={handleReset}
              disabled={empty && !sending}
            >
              <SquarePen />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Nouvelle conversation</TooltipContent>
        </Tooltip>
        <Button type="button" variant="ghost" size="icon" aria-label="Fermer l’assistant" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation avec l’assistant"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        <Bubble role="assistant">
          <p>{WELCOME}</p>
          {empty ? <p className="mt-2">Que souhaitez-vous faire ?</p> : null}
        </Bubble>

        {empty ? (
          <div className="flex flex-wrap gap-2" aria-label="Suggestions de questions" role="group">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => submit(suggestion)}
                className="rounded-full border border-border-strong bg-background px-3 py-1.5 text-left text-xs text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {turns.map((turn, index) => (
          <Bubble key={index} role={turn.role}>
            {turn.role === "assistant" ? <Markdown source={turn.content} /> : turn.content}
          </Bubble>
        ))}

        {sending ? <TypingIndicator /> : null}

        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <p>{error}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={retry}>
              Réessayer
            </Button>
          </div>
        ) : null}
      </div>

      <form
        className="shrink-0 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={MAX_CONTENT_CHARS}
            rows={1}
            placeholder="Posez votre question…"
            aria-label="Votre question"
            className="max-h-32 min-h-10 resize-none"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Envoyer"
            disabled={sending || draft.trim() === ""}
            className="size-10 shrink-0"
          >
            <SendHorizontal />
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          L’assistant peut se tromper. Ne partagez jamais de mot de passe ni de jeton.
        </p>
      </form>
    </motion.section>
  );
}
