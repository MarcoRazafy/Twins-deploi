import type { ClaudeEvent, ClaudeStatus } from "@/lib/claude-events";
import { CLAUDE_DEFAULT_CWD } from "@/lib/claude-events";

const GENERIC_ERROR = "Claude Code n’a pas pu démarrer. Réessayez dans un instant.";
const HEADERS = { "Content-Type": "application/json", "X-Mini-Railway": "1" };

function errorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message !== "" ? message : null;
}

async function failure(response: Response): Promise<Error> {
  if (response.status === 401) return new Error("Votre session a expiré. Reconnectez-vous pour utiliser Claude Code.");
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (proxy error page): generic message.
  }
  return new Error(errorMessage(body) ?? GENERIC_ERROR);
}

/** Whether the server has the root helper. Throws an Error with a French message. */
export async function fetchClaudeStatus(): Promise<ClaudeStatus> {
  const response = await fetch("/api/claude", { headers: HEADERS, cache: "no-store" });
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as Partial<ClaudeStatus>;
  return {
    available: body.available === true,
    defaultCwd: typeof body.defaultCwd === "string" ? body.defaultCwd : CLAUDE_DEFAULT_CWD,
  };
}

function isClaudeEvent(value: unknown): value is ClaudeEvent {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

export interface TurnRequest {
  prompt: string;
  sessionId: string | null;
  cwd: string;
}

/**
 * Runs one turn and calls `onEvent` for each event of its SSE stream. Resolves
 * when the stream ends; aborting `signal` stops the turn on the server too.
 * Throws an Error with a French message when the turn could not start, and the
 * fetch's own AbortError when it was aborted.
 */
export async function streamTurn(
  request: TurnRequest,
  signal: AbortSignal,
  onEvent: (event: ClaudeEvent) => void,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/claude", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(request),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("Connexion impossible. Vérifiez votre réseau puis réessayez.");
  }
  if (!response.ok || !response.body) throw await failure(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\n\n");
    pending = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        // Comment lines (": ping") keep the connection alive and carry nothing.
        if (!line.startsWith("data:")) continue;
        try {
          const event: unknown = JSON.parse(line.slice(5));
          if (isClaudeEvent(event)) onEvent(event);
        } catch {
          // A damaged frame is skipped; the turn goes on.
        }
      }
    }
  }
}
