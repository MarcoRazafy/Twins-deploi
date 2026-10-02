import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/contract";
import { authenticate, SESSION_COOKIE } from "@/server/auth";
import { db } from "@/server/db";
import { readLogEntries } from "@/server/deployments/logs";
import { isFinished } from "@/server/deployments/status";
import { notFound } from "@/server/errors";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_INTERVAL_MS = 25_000;
const POLL_INTERVAL_MS = 500;
/** Lines sent per frame; a longer backlog is drained without waiting between frames. */
const BATCH_SIZE = 500;

/** `after` = seq of the last line the client already has. */
function parseCursor(value: string | null): number | null {
  return value !== null && /^\d{1,9}$/.test(value) ? Number(value) : null;
}

/**
 * GET /api/logs/deployments/<id>?after=<seq>
 *
 * Server-sent events: `data: <LogLine[] JSON>` frames for the lines appended
 * after `after` (default: the current last line, the client loads the history
 * through deployments.getLogs), then `event: end` once the deployment is
 * finished and every line has been sent.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: deploymentId } = await context.params;
  let cursor = 0;
  try {
    const identity = await authenticate({
      sessionToken: request.cookies.get(SESSION_COOKIE)?.value ?? null,
      authorization: request.headers.get("authorization"),
    });
    if (!identity.user) {
      throw new ApiError("forbidden", "Vous devez être connecté pour effectuer cette action.");
    }
    const deployment = await db().deployment.findUnique({
      where: { id: deploymentId },
      select: { logSeq: true },
    });
    if (!deployment) throw notFound("Déploiement");
    cursor = parseCursor(request.nextUrl.searchParams.get("after")) ?? deployment.logSeq;
  } catch (error) {
    const { status, body } = errorResponse(error, false, "deployment logs");
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }

  const encoder = new TextEncoder();
  let cleanup = (): void => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const send = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const ping = setInterval(() => send(": ping\n\n"), PING_INTERVAL_MS);
      cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };

      const poll = async (): Promise<void> => {
        timer = null;
        if (closed) return;
        let delay = POLL_INTERVAL_MS;
        try {
          // Status BEFORE the lines: the worker appends its last lines before it
          // finishes the deployment, so a deployment seen as finished here has
          // nothing left that the read below could miss.
          const current = await db().deployment.findUnique({
            where: { id: deploymentId },
            select: { status: true },
          });
          const entries = current ? await readLogEntries(deploymentId, cursor, BATCH_SIZE) : [];
          if (entries.length > 0) {
            cursor = entries[entries.length - 1].seq;
            send(`data: ${JSON.stringify(entries.map((entry) => entry.line))}\n\n`);
            if (entries.length === BATCH_SIZE) delay = 0;
          } else if (!current || isFinished(current.status)) {
            send("event: end\ndata: {}\n\n");
            cleanup();
            return;
          }
        } catch (error) {
          // Transient database error: keep the stream open and try again.
          console.error("[api] deployment logs poll failed:", error);
        }
        if (!closed) {
          timer = setTimeout(() => {
            void poll();
          }, delay);
        }
      };

      request.signal.addEventListener("abort", cleanup);
      if (request.signal.aborted) cleanup();
      send(": connected\n\n");
      void poll();
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
