/**
 * The turn in progress. It lives at module level, not in a component: leaving
 * the page does not stop Claude Code, and coming back shows the answer that
 * kept arriving in the store.
 */

import type { ClaudeEvent } from "@/lib/claude-events";

import { updateConversation, type ChatItem, type Conversation } from "./conversation-store";
import { streamTurn } from "./request";

interface ActiveTurn {
  conversationId: string;
  controller: AbortController;
}

let active: ActiveTurn | null = null;
const listeners = new Set<() => void>();

function setActive(next: ActiveTurn | null): void {
  active = next;
  for (const listener of listeners) listener();
}

/** Id of the conversation Claude Code is working on, or null. */
export function getRunningConversationId(): string | null {
  return active?.conversationId ?? null;
}

export function getServerRunningConversationId(): string | null {
  return null;
}

export function subscribeRunning(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function append(conversation: Conversation, item: ChatItem): Conversation {
  return { ...conversation, items: [...conversation.items, item] };
}

function applyEvent(conversation: Conversation, event: ClaudeEvent): Conversation {
  const { items } = conversation;
  switch (event.type) {
    case "session":
      return { ...conversation, sessionId: event.sessionId };
    case "text": {
      const last = items[items.length - 1];
      if (last?.kind === "text") {
        return { ...conversation, items: [...items.slice(0, -1), { kind: "text", text: last.text + event.text }] };
      }
      // A separator between two blocks has nothing to separate at the start of an answer.
      return event.text.trim() === "" ? conversation : append(conversation, { kind: "text", text: event.text });
    }
    case "tool":
      return append(conversation, {
        kind: "tool",
        id: event.id,
        name: event.name,
        input: event.input,
        output: null,
        isError: false,
      });
    case "tool_result":
      return {
        ...conversation,
        items: items.map((item) =>
          item.kind === "tool" && item.id === event.id
            ? { ...item, output: event.output, isError: event.isError }
            : item,
        ),
      };
    case "error":
      return append(conversation, { kind: "notice", tone: "error", text: event.message });
    case "done":
      return conversation;
  }
}

/** Sends `prompt` in a conversation. Ignored while another turn is running. */
export function runTurn(conversationId: string, sessionId: string | null, cwd: string, prompt: string): void {
  if (active !== null) return;
  const controller = new AbortController();
  setActive({ conversationId, controller });
  updateConversation(conversationId, (conversation) => append(conversation, { kind: "user", text: prompt }), true);

  let ended = false;
  const notice = (tone: "info" | "error", text: string): void => {
    updateConversation(conversationId, (conversation) => append(conversation, { kind: "notice", tone, text }), true);
  };

  streamTurn({ prompt, sessionId, cwd }, controller.signal, (event) => {
    if (event.type === "done" || event.type === "error") ended = true;
    updateConversation(conversationId, (conversation) => applyEvent(conversation, event), ended);
  })
    .then(
      () => {
        if (!ended) {
          notice("error", "La connexion avec le serveur a été interrompue avant la fin de la réponse.");
        }
      },
      (failure: unknown) => {
        if (controller.signal.aborted) notice("info", "Tâche arrêtée.");
        else notice("error", failure instanceof Error ? failure.message : "Claude Code n’a pas pu répondre.");
      },
    )
    .finally(() => {
      if (active?.controller === controller) setActive(null);
    });
}

/** Stops the turn in progress, here and on the server. */
export function stopTurn(): void {
  active?.controller.abort();
}
