import { NextResponse, type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/contract";
import {
  CLAUDE_DEFAULT_CWD,
  CLAUDE_MAX_PROMPT_CHARS,
  type ClaudeEvent,
  type ClaudeStatus,
} from "@/lib/claude-events";
import type { UserProfile } from "@/lib/types";
import { authenticate, SESSION_COOKIE } from "@/server/auth";
import {
  CLAUDE_NOT_CONFIGURED,
  claudeHelperPath,
  isClaudeSessionId,
  normalizeCwd,
  startClaudeTurn,
} from "@/server/claude/run";
import { hasRole } from "@/server/context";
import { clientAddress, errorResponse, passesCsrf, readBodyText } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const PING_INTERVAL_MS = 25_000;
/** Each turn is a root agent with its own process tree: keep the machine usable. */
const MAX_CONCURRENT_TURNS = 4;

// In memory, one web process (same trade-off as the assistant's rate limiting).
const globalStore = globalThis as typeof globalThis & {
  __miniRailwayClaudeTurns?: Set<string>;
};
/** Ids of the users with a turn in progress: one turn per user at a time. */
const activeTurns: Set<string> = (globalStore.__miniRailwayClaudeTurns ??= new Set());

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function invalid(message: string): ApiError {
  return new ApiError("validation", message);
}

/**
 * Claude Code runs as root without asking: the page is for members who already
 * deploy and configure everything (developer and above), never for viewers.
 */
async function requireMember(request: NextRequest): Promise<UserProfile> {
  const identity = await authenticate({
    sessionToken: request.cookies.get(SESSION_COOKIE)?.value ?? null,
    authorization: request.headers.get("authorization"),
  });
  if (identity.user === null) {
    throw new ApiError("forbidden", "Connectez-vous pour utiliser Claude Code.");
  }
  if (!hasRole(identity.user.role, "developer")) {
    throw new ApiError("forbidden", "Votre rôle ne permet pas d’utiliser Claude Code.");
  }
  return identity.user;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let authenticated = false;
  try {
    await requireMember(request);
    authenticated = true;
    const status: ClaudeStatus = { available: claudeHelperPath() !== null, defaultCwd: CLAUDE_DEFAULT_CWD };
    return json(status, 200);
  } catch (error) {
    const { status, body } = errorResponse(error, authenticated, "claude status");
    return json(body, status);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  let authenticated = false;
  let user: UserProfile;
  let prompt: string;
  let sessionId: string | null;
  let cwd: string;
  try {
    if (!passesCsrf(request.headers)) {
      // Always 403 here (errorResponse would turn it into 401 for an anonymous caller).
      return json({ error: { code: "forbidden", message: "Requête refusée : origine non autorisée." } }, 403);
    }
    user = await requireMember(request);
    authenticated = true;
    if (claudeHelperPath() === null) throw new ApiError("unavailable", CLAUDE_NOT_CONFIGURED);

    const text = await readBodyText(request, MAX_BODY_BYTES);
    if (text === null) throw invalid("La requête est trop volumineuse.");
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw invalid("La requête n’est pas un JSON valide.");
    }
    const body = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};

    if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
      throw invalid("Écrivez un message pour Claude Code.");
    }
    if (body.prompt.length > CLAUDE_MAX_PROMPT_CHARS) {
      throw invalid(`Le message dépasse ${CLAUDE_MAX_PROMPT_CHARS} caractères.`);
    }
    prompt = body.prompt;

    sessionId = typeof body.sessionId === "string" && body.sessionId !== "" ? body.sessionId : null;
    if (sessionId !== null && !isClaudeSessionId(sessionId)) {
      throw invalid("Cette conversation ne peut pas être reprise : démarrez-en une nouvelle.");
    }
    const normalized = normalizeCwd(typeof body.cwd === "string" ? body.cwd : null);
    if (normalized === null) throw invalid("Le dossier de travail doit être un chemin absolu.");
    cwd = normalized;

    if (activeTurns.has(user.id)) {
      throw new ApiError("conflict", "Claude Code travaille déjà pour vous : attendez la fin ou arrêtez la tâche en cours.");
    }
    if (activeTurns.size >= MAX_CONCURRENT_TURNS) {
      throw new ApiError("unavailable", "Trop de tâches Claude Code en cours sur le serveur. Réessayez dans un instant.");
    }
  } catch (error) {
    const { status, body } = errorResponse(error, authenticated, `claude (${clientAddress(request.headers)})`);
    return json(body, status);
  }

  const userId = user.id;
  activeTurns.add(userId);
  // The audit trail of a root agent: who asked, where, which session. Never the prompt.
  console.info(
    `[claude] turn started by ${user.email} (${clientAddress(request.headers)}) cwd=${cwd} session=${sessionId ?? "new"}`,
  );

  const encoder = new TextEncoder();
  let cleanup = (): void => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const turn = startClaudeTurn({ prompt, sessionId, cwd }, (event: ClaudeEvent) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      const ping = setInterval(() => send(": ping\n\n"), PING_INTERVAL_MS);
      cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        request.signal.removeEventListener("abort", cleanup);
        // The reader left (stop button, closed tab): the turn stops with it.
        turn.cancel();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      request.signal.addEventListener("abort", cleanup);
      if (request.signal.aborted) cleanup();
      send(": connected\n\n");
      void turn.done.then(() => {
        activeTurns.delete(userId);
        console.info(`[claude] turn ended for ${user.email}`);
        cleanup();
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
