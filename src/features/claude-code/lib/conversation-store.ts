/**
 * Conversations with Claude Code, kept in this browser's localStorage behind a
 * tiny external store (read with `useSyncExternalStore`, like the assistant's).
 * The server keeps nothing but Claude Code's own session files: `sessionId` is
 * what lets a later message continue the same session.
 */

export type ChatItem =
  | { kind: "user"; text: string }
  /** Answer text, Markdown, written piece by piece while it streams. */
  | { kind: "text"; text: string }
  /** `output` is null until the tool has answered. */
  | { kind: "tool"; id: string; name: string; input: string; output: string | null; isError: boolean }
  | { kind: "notice"; tone: "info" | "error"; text: string };

export interface Conversation {
  id: string;
  title: string;
  /** Working directory, fixed when the conversation starts. */
  cwd: string;
  /** Claude Code session to resume; null until the first turn has started. */
  sessionId: string | null;
  items: readonly ChatItem[];
  updatedAt: number;
}

export interface ConversationState {
  /** Most recently used first. */
  conversations: readonly Conversation[];
  /** Null = the "new conversation" screen. */
  activeId: string | null;
  /** Working directory proposed for the next new conversation. */
  lastCwd: string | null;
}

const STORAGE_KEY = "mini-railway:claude-code";
const MAX_CONVERSATIONS = 30;
const MAX_STORED_ITEMS = 400;
const MAX_STORED_TOOL_CHARS = 3_000;
const PERSIST_DELAY_MS = 400;
const TITLE_CHARS = 60;

const EMPTY: ConversationState = { conversations: [], activeId: null, lastCwd: null };

let cache: ConversationState | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function parseItem(value: unknown): ChatItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if ((item.kind === "user" || item.kind === "text") && typeof item.text === "string") {
    return { kind: item.kind, text: item.text };
  }
  if (item.kind === "notice" && typeof item.text === "string") {
    return { kind: "notice", tone: item.tone === "error" ? "error" : "info", text: item.text };
  }
  if (
    item.kind === "tool" &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.input === "string"
  ) {
    return {
      kind: "tool",
      id: item.id,
      name: item.name,
      input: item.input,
      output: typeof item.output === "string" ? item.output : null,
      isError: item.isError === true,
    };
  }
  return null;
}

function parseConversation(value: unknown): Conversation | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || typeof entry.title !== "string" || typeof entry.cwd !== "string") return null;
  const items = Array.isArray(entry.items)
    ? entry.items.map(parseItem).filter((item): item is ChatItem => item !== null)
    : [];
  return {
    id: entry.id,
    title: entry.title,
    cwd: entry.cwd,
    sessionId: typeof entry.sessionId === "string" ? entry.sessionId : null,
    items,
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
  };
}

function parse(raw: string | null): ConversationState {
  if (raw === null) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return EMPTY;
    const state = value as Record<string, unknown>;
    const conversations = Array.isArray(state.conversations)
      ? state.conversations
          .map(parseConversation)
          .filter((entry): entry is Conversation => entry !== null)
          .slice(0, MAX_CONVERSATIONS)
      : [];
    const activeId =
      typeof state.activeId === "string" && conversations.some((entry) => entry.id === state.activeId)
        ? state.activeId
        : null;
    return { conversations, activeId, lastCwd: typeof state.lastCwd === "string" ? state.lastCwd : null };
  } catch {
    return EMPTY;
  }
}

function clipped(text: string): string {
  return text.length > MAX_STORED_TOOL_CHARS ? `${text.slice(0, MAX_STORED_TOOL_CHARS)}\n…` : text;
}

/** What goes to storage: long tool traffic is shortened, the newest items are kept. */
function storable(state: ConversationState, keep: number): ConversationState {
  return {
    ...state,
    conversations: state.conversations.slice(0, keep).map((conversation) => ({
      ...conversation,
      items: conversation.items.slice(-MAX_STORED_ITEMS).map((item) =>
        item.kind === "tool"
          ? { ...item, input: clipped(item.input), output: item.output === null ? null : clipped(item.output) }
          : item,
      ),
    })),
  };
}

function persistNow(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (cache === null) return;
  // Storage full: retry with fewer conversations rather than lose the current one.
  for (const keep of [MAX_CONVERSATIONS, 10, 3, 1]) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storable(cache, keep)));
      return;
    } catch {
      // Blocked or full: next attempt, then memory only.
    }
  }
}

function commit(next: ConversationState, urgent: boolean): void {
  cache = next;
  if (urgent) persistNow();
  else persistTimer ??= setTimeout(persistNow, PERSIST_DELAY_MS);
  for (const listener of listeners) listener();
}

export function getConversationState(): ConversationState {
  if (cache === null) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage blocked: conversations live in memory only.
    }
    cache = parse(raw);
  }
  return cache;
}

export function getServerConversationState(): ConversationState {
  return EMPTY;
}

export function subscribeConversations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function titleOf(prompt: string): string {
  const line = prompt.trim().split("\n")[0].trim();
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
}

/** Creates a conversation from its first message, makes it active and returns its id. */
export function createConversation(cwd: string, prompt: string): string {
  const state = getConversationState();
  const conversation: Conversation = {
    id: newId(),
    title: titleOf(prompt),
    cwd,
    sessionId: null,
    items: [],
    updatedAt: Date.now(),
  };
  commit(
    {
      conversations: [conversation, ...state.conversations].slice(0, MAX_CONVERSATIONS),
      activeId: conversation.id,
      lastCwd: cwd,
    },
    true,
  );
  return conversation.id;
}

/**
 * Applies `change` to one conversation. `urgent` writes to storage at once
 * (end of a turn); streamed pieces are written at most every 400 ms.
 */
export function updateConversation(
  id: string,
  change: (conversation: Conversation) => Conversation,
  urgent = false,
): void {
  const state = getConversationState();
  if (!state.conversations.some((entry) => entry.id === id)) return;
  commit(
    {
      ...state,
      conversations: state.conversations.map((entry) =>
        entry.id === id ? { ...change(entry), updatedAt: Date.now() } : entry,
      ),
    },
    urgent,
  );
}

export function selectConversation(id: string | null): void {
  const state = getConversationState();
  if (state.activeId === id) return;
  commit({ ...state, activeId: id }, true);
}

export function deleteConversation(id: string): void {
  const state = getConversationState();
  commit(
    {
      ...state,
      conversations: state.conversations.filter((entry) => entry.id !== id),
      activeId: state.activeId === id ? null : state.activeId,
    },
    true,
  );
}
