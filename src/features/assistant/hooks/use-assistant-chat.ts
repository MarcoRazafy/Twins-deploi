"use client";

import { useRef, useState, useSyncExternalStore } from "react";

import {
  getConversation,
  getServerConversation,
  setConversation,
  subscribeConversation,
  type ChatTurn,
} from "../lib/conversation-store";
import { requestReply } from "../lib/request";

export interface AssistantChat {
  turns: readonly ChatTurn[];
  sending: boolean;
  /** French message of the last failure; the last turn is then the unanswered question. */
  error: string | null;
  send: (text: string) => void;
  retry: () => void;
  reset: () => void;
}

/** Conversation state of the assistant. `page` is the current pathname, sent as context. */
export function useAssistantChat(page: string): AssistantChat {
  const turns = useSyncExternalStore(subscribeConversation, getConversation, getServerConversation);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by `reset`: an answer that comes back for an older conversation is dropped.
  const generation = useRef(0);

  function ask(history: readonly ChatTurn[]) {
    const current = generation.current;
    setSending(true);
    setError(null);
    requestReply(history, page).then(
      (reply) => {
        if (generation.current !== current) return;
        setConversation([...getConversation(), { role: "assistant", content: reply }]);
        setSending(false);
      },
      (failure: unknown) => {
        if (generation.current !== current) return;
        setError(failure instanceof Error ? failure.message : "L’assistant n’a pas pu répondre.");
        setSending(false);
      },
    );
  }

  function send(text: string) {
    const content = text.trim();
    if (content === "" || sending) return;
    const history: readonly ChatTurn[] = [...getConversation(), { role: "user", content }];
    setConversation(history);
    ask(history);
  }

  function retry() {
    if (sending) return;
    const history = getConversation();
    if (history.length === 0 || history[history.length - 1].role !== "user") return;
    ask(history);
  }

  function reset() {
    generation.current += 1;
    setConversation([]);
    setSending(false);
    setError(null);
  }

  return { turns, sending, error, send, retry, reset };
}
