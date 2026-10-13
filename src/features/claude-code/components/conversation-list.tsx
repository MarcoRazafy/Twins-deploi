"use client";

import { Trash2 } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { Conversation } from "../lib/conversation-store";

interface ConversationListProps {
  conversations: readonly Conversation[];
  activeId: string | null;
  runningId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

/** History of this browser, most recent first. */
export function ConversationList({ conversations, activeId, runningId, onSelect, onRemove }: ConversationListProps) {
  if (conversations.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">Aucune conversation pour l’instant.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {conversations.map((conversation) => {
        const active = conversation.id === activeId;
        return (
          <li key={conversation.id} className="group/row relative">
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(conversation.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md py-1.5 pr-8 pl-3 text-left text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "bg-accent text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
              {conversation.id === runningId ? <Spinner className="size-3 shrink-0" aria-label="En cours" /> : null}
            </button>
            <button
              type="button"
              aria-label={`Supprimer « ${conversation.title} »`}
              onClick={() => onRemove(conversation.id)}
              className="absolute top-1/2 right-1.5 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none group-focus-within/row:flex group-hover/row:flex hover:bg-background hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
