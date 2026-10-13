"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { CLAUDE_DEFAULT_CWD, type ClaudeStatus } from "@/lib/claude-events";

import {
  createConversation,
  deleteConversation,
  getConversationState,
  getServerConversationState,
  selectConversation,
  subscribeConversations,
  type Conversation,
} from "../lib/conversation-store";
import { fetchClaudeStatus } from "../lib/request";
import {
  getRunningConversationId,
  getServerRunningConversationId,
  runTurn,
  stopTurn,
  subscribeRunning,
} from "../lib/runner";

export interface ClaudeCode {
  conversations: readonly Conversation[];
  /** Null on the "new conversation" screen. */
  active: Conversation | null;
  /** Id of the conversation Claude Code is working on, or null. */
  runningId: string | null;
  /** Undefined while loading. */
  status: ClaudeStatus | undefined;
  /** French message when the status could not be read. */
  statusError: string | null;
  /** Working directory proposed for a new conversation. */
  defaultCwd: string;
  /** Sends a message; `cwd` only matters for the first message of a conversation. */
  send: (prompt: string, cwd: string) => void;
  stop: () => void;
  select: (id: string | null) => void;
  remove: (id: string) => void;
}

/** Not an entity collection: its own key family, never touched by realtime events. */
const STATUS_KEY = ["claude-code", "status"] as const;

export function useClaudeCode(): ClaudeCode {
  const state = useSyncExternalStore(subscribeConversations, getConversationState, getServerConversationState);
  const runningId = useSyncExternalStore(subscribeRunning, getRunningConversationId, getServerRunningConversationId);
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: fetchClaudeStatus, staleTime: 60_000, retry: false });

  const active = state.conversations.find((entry) => entry.id === state.activeId) ?? null;

  function send(prompt: string, cwd: string) {
    const text = prompt.trim();
    if (text === "" || runningId !== null) return;
    if (active === null) {
      const id = createConversation(cwd.trim() || CLAUDE_DEFAULT_CWD, text);
      runTurn(id, null, cwd.trim() || CLAUDE_DEFAULT_CWD, text);
    } else {
      runTurn(active.id, active.sessionId, active.cwd, text);
    }
  }

  function remove(id: string) {
    if (runningId === id) stopTurn();
    deleteConversation(id);
  }

  return {
    conversations: state.conversations,
    active,
    runningId,
    status: status.data,
    statusError: status.isError ? status.error.message : null,
    defaultCwd: state.lastCwd ?? status.data?.defaultCwd ?? CLAUDE_DEFAULT_CWD,
    send,
    stop: stopTurn,
    select: selectConversation,
    remove,
  };
}
