import type { NextRequest } from "next/server";

import { ApiError, type ApiEvent } from "@/lib/api/contract";
import { authenticate, SESSION_COOKIE } from "@/server/auth";
import { eventsReady, subscribeEvents } from "@/server/events";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_INTERVAL_MS = 25_000;

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const identity = await authenticate({
      sessionToken: request.cookies.get(SESSION_COOKIE)?.value ?? null,
      authorization: request.headers.get("authorization"),
    });
    if (!identity.user) {
      throw new ApiError("forbidden", "Vous devez être connecté pour effectuer cette action.");
    }
    // Subscribers must not miss what is emitted right after the stream opens.
    await eventsReady();
  } catch (error) {
    const { status, body } = errorResponse(error, false, "events");
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }

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
      const unsubscribe = subscribeEvents((event: ApiEvent) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
      const ping = setInterval(() => send(": ping\n\n"), PING_INTERVAL_MS);
      cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      request.signal.addEventListener("abort", cleanup);
      if (request.signal.aborted) cleanup();
      send(": connected\n\n");
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
