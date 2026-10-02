import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/contract";
import type { LogLine } from "@/lib/types";
import { authenticate, SESSION_COOKIE } from "@/server/auth";
import { createRuntimeLineMapper, followLogs, requireDocker, type LogFollower } from "@/server/docker";
import { findContainerService } from "@/server/docker/lookup";
import { notFound } from "@/server/errors";
import { errorResponse } from "@/server/http";
import { publicContainerId } from "@/server/mappers/container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_INTERVAL_MS = 25_000;
/** Lines are grouped: one frame per interval at most. */
const BATCH_INTERVAL_MS = 200;
const BATCH_SIZE = 500;

/**
 * GET /api/logs/containers/<id>
 *
 * Server-sent events following `docker logs -f --tail 0 --timestamps` of the
 * container of a service: `data: <LogLine[] JSON>` frames, then `event: end`
 * when the container stops. `<id>` is the public container id returned by
 * docker.listContainers; it is resolved against the database and only the
 * container name stored there is ever handed to docker.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  let containerName: string;
  let containerId: string;
  try {
    const identity = await authenticate({
      sessionToken: request.cookies.get(SESSION_COOKIE)?.value ?? null,
      authorization: request.headers.get("authorization"),
    });
    if (!identity.user) {
      throw new ApiError("forbidden", "Vous devez être connecté pour effectuer cette action.");
    }
    const service = await findContainerService(id);
    if (!service || service.containerName === null) throw notFound("Conteneur");
    await requireDocker();
    containerName = service.containerName;
    containerId = publicContainerId(service);
  } catch (error) {
    const { status, body } = errorResponse(error, false, "container logs");
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }

  const encoder = new TextEncoder();
  let cleanup = (): void => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let follower: LogFollower | null = null;
      let pending: LogLine[] = [];
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const send = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const flush = (): void => {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = null;
        if (pending.length === 0) return;
        const lines = pending;
        pending = [];
        send(`data: ${JSON.stringify(lines)}\n\n`);
      };
      const ping = setInterval(() => send(": ping\n\n"), PING_INTERVAL_MS);
      cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        if (flushTimer) clearTimeout(flushTimer);
        request.signal.removeEventListener("abort", cleanup);
        // Kills the `docker logs -f` process.
        follower?.stop();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };

      request.signal.addEventListener("abort", cleanup);
      send(": connected\n\n");
      if (request.signal.aborted) {
        cleanup();
        return;
      }

      const toLine = createRuntimeLineMapper(containerId);
      follower = followLogs(containerName, (raw) => {
        if (closed) return;
        pending.push(toLine(raw));
        if (pending.length >= BATCH_SIZE) flush();
        else flushTimer ??= setTimeout(flush, BATCH_INTERVAL_MS);
      });
      void follower.done.then(() => {
        // The container stopped or was replaced: the client subscribes again when it needs to.
        flush();
        send("event: end\ndata: {}\n\n");
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
