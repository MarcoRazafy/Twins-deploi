import { NextResponse, type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/contract";
import { buildSystemPrompt } from "@/server/assistant/knowledge";
import { askMistral, type ChatMessage } from "@/server/assistant/mistral";
import { authenticate, SESSION_COOKIE } from "@/server/auth";
import { clientAddress, errorResponse, passesCsrf, readBodyText } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 100 * 1024;
const MAX_MESSAGES = 20;
const MAX_CONTENT_CHARS = 2000;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_TRACKED_USERS = 5_000;

// In memory, per user, one web process (same trade-off as the login throttling).
const globalStore = globalThis as typeof globalThis & {
  __miniRailwayAssistantHits?: Map<string, number[]>;
};
const hits: Map<string, number[]> = (globalStore.__miniRailwayAssistantHits ??= new Map());

/** Seconds to wait before the next request is accepted (0 = accepted, and counted). */
function takeRateSlot(userId: string, now: number): number {
  const recent = (hits.get(userId) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(userId, recent);
    return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  hits.delete(userId);
  hits.set(userId, recent);
  // Re-inserted on every use, so the Map iterates from the least recently active user.
  for (const key of hits.keys()) {
    if (hits.size <= MAX_TRACKED_USERS) break;
    hits.delete(key);
  }
  return 0;
}

function json(body: unknown, status: number, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function invalid(message: string): ApiError {
  return new ApiError("validation", message);
}

function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw invalid("La conversation est vide.");
  if (value.length > MAX_MESSAGES) throw invalid("La conversation est trop longue : démarrez-en une nouvelle.");
  const messages = value.map((item): ChatMessage => {
    const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const { role, content } = entry;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      throw invalid("Un message de la conversation est invalide.");
    }
    if (content.length > MAX_CONTENT_CHARS) {
      throw invalid(`Un message dépasse ${MAX_CONTENT_CHARS} caractères.`);
    }
    return { role, content };
  });
  if (messages[messages.length - 1].role !== "user" || messages[messages.length - 1].content.trim() === "") {
    throw invalid("Posez une question pour obtenir une réponse.");
  }
  return messages;
}

/** The page is only context: keep a plain path, drop anything else. */
function parsePage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.split(/[?#]/)[0].slice(0, 200);
  return /^\/[A-Za-z0-9_\-/]*$/.test(path) ? path : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let authenticated = false;
  try {
    if (!passesCsrf(request.headers)) {
      // Always 403 here (errorResponse would turn it into 401 for an anonymous caller).
      return json({ error: { message: "Requête refusée : origine non autorisée." } }, 403);
    }

    const identity = await authenticate({
      sessionToken: request.cookies.get(SESSION_COOKIE)?.value ?? null,
      authorization: request.headers.get("authorization"),
    });
    authenticated = identity.user !== null;
    if (identity.user === null) {
      throw new ApiError("forbidden", "Connectez-vous pour utiliser l’assistant.");
    }

    const text = await readBodyText(request, MAX_BODY_BYTES);
    if (text === null) throw invalid("La requête est trop volumineuse.");
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw invalid("La requête n’est pas un JSON valide.");
    }
    const body = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
    const messages = parseMessages(body.messages);
    const page = parsePage(body.page);

    const wait = takeRateSlot(identity.user.id, Date.now());
    if (wait > 0) {
      return json(
        {
          error: {
            code: "unavailable",
            message: "Trop de questions en peu de temps. Patientez un instant avant de réessayer.",
          },
        },
        429,
        { "Retry-After": String(wait) },
      );
    }

    const reply = await askMistral(buildSystemPrompt(page), messages);
    return json({ reply }, 200);
  } catch (error) {
    const { status, body } = errorResponse(error, authenticated, `assistant (${clientAddress(request.headers)})`);
    return json({ error: { message: body.error.message } }, status);
  }
}
