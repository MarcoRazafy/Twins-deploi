"use client";

import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CLAUDE_MAX_PROMPT_CHARS } from "@/lib/claude-events";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  /** Claude Code is working on the conversation shown: the button stops it. */
  running: boolean;
  /** Another conversation is running, or the page is not usable. */
  disabled: boolean;
  placeholder: string;
}

export function Composer({ value, onChange, onSubmit, onStop, running, disabled, placeholder }: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!running && !disabled) onSubmit();
    }
  }

  return (
    <form
      className="shrink-0 border-t bg-background px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (running) onStop();
        else if (!disabled) onSubmit();
      }}
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={CLAUDE_MAX_PROMPT_CHARS}
            rows={1}
            placeholder={placeholder}
            aria-label="Message pour Claude Code"
            className="max-h-48 min-h-10 resize-none"
          />
          {running ? (
            <Button type="submit" variant="outline" size="icon" aria-label="Arrêter" className="size-10 shrink-0">
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              aria-label="Envoyer"
              disabled={disabled || value.trim() === ""}
              className="size-10 shrink-0"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Claude Code agit en root sur ce serveur, sans demander de confirmation. Entrée pour envoyer, Maj+Entrée
          pour une nouvelle ligne.
        </p>
      </div>
    </form>
  );
}
