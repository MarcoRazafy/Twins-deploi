/**
 * Thin client of the Mistral chat completions API. The key comes from the
 * server environment only: it is never logged, never put in an error message
 * and never sent to the browser.
 */

import { ApiError } from "@/lib/api/contract";

import { env } from "../env";

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 700;
const TEMPERATURE = 0.2;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function unavailable(message: string): ApiError {
  return new ApiError("unavailable", message);
}

/** The reply text out of a chat completions body, or null when the shape is unexpected. */
function replyOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown } | null)?.message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim() || null;
  if (Array.isArray(content)) {
    // Content can arrive as typed chunks: keep the text ones.
    const text = content
      .map((chunk) =>
        typeof chunk === "object" && chunk !== null && typeof (chunk as { text?: unknown }).text === "string"
          ? (chunk as { text: string }).text
          : "",
      )
      .join("")
      .trim();
    return text || null;
  }
  return null;
}

/** Sends the conversation to Mistral; throws an ApiError carrying a French, displayable message. */
export async function askMistral(system: string, messages: readonly ChatMessage[]): Promise<string> {
  const apiKey = env.mistralApiKey;
  if (apiKey === null) {
    throw unavailable("L’assistant n’est pas configuré sur ce serveur : la clé Mistral est absente.");
  }

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.mistralModel,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "system", content: system }, ...messages],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw unavailable(
      timedOut
        ? "L’assistant a mis trop de temps à répondre. Réessayez dans un instant."
        : "Impossible de joindre le service de l’assistant. Vérifiez la connexion du serveur à Internet.",
    );
  }

  if (!response.ok) {
    // Drain the body without keeping it: it is never shown to the user.
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      throw unavailable("La clé Mistral est refusée. L’administrateur doit la vérifier.");
    }
    if (response.status === 429) {
      throw unavailable("L’assistant reçoit trop de demandes pour le moment. Réessayez dans une minute.");
    }
    throw unavailable("L’assistant est momentanément indisponible. Réessayez plus tard.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw unavailable("L’assistant a renvoyé une réponse illisible. Réessayez.");
  }
  const reply = replyOf(body);
  if (reply === null) throw unavailable("L’assistant n’a pas produit de réponse. Reformulez votre question.");
  return reply;
}
