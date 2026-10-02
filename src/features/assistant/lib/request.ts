import type { ChatTurn } from "./conversation-store";

/** Mirrors the limits enforced by POST /api/assistant. */
export const MAX_MESSAGES = 20;
export const MAX_CONTENT_CHARS = 2000;
const REQUEST_TIMEOUT_MS = 45_000;

const GENERIC_ERROR = "L’assistant n’a pas pu répondre. Réessayez dans un instant.";

function errorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message !== "" ? message : null;
}

/** Asks the server for the next assistant reply. Throws an Error with a French message. */
export async function requestReply(turns: readonly ChatTurn[], page: string): Promise<string> {
  const recent = turns.slice(-MAX_MESSAGES);
  // A conversation always starts with the user's question.
  const start = recent.findIndex((turn) => turn.role === "user");
  const messages = recent
    .slice(Math.max(start, 0))
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_CONTENT_CHARS) }));

  let response: Response;
  try {
    response = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Mini-Railway": "1" },
      body: JSON.stringify({ messages, page }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new Error(
      timedOut
        ? "L’assistant met trop de temps à répondre. Réessayez dans un instant."
        : "Connexion impossible. Vérifiez votre réseau puis réessayez.",
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body: handled below with the generic message.
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("Votre session a expiré. Reconnectez-vous pour utiliser l’assistant.");
    throw new Error(errorMessage(body) ?? GENERIC_ERROR);
  }
  const reply = typeof body === "object" && body !== null ? (body as { reply?: unknown }).reply : undefined;
  if (typeof reply !== "string" || reply.trim() === "") throw new Error(GENERIC_ERROR);
  return reply;
}
