/**
 * Host ports of the containers: 20000-29999, published on the loopback only
 * (NGINX is the single way in).
 */

import net from "node:net";

import { db } from "../db";
import { unavailable } from "../errors";
import { APP_PORT_RANGE } from "../proxy";

const LOOPBACK = "127.0.0.1";

/** True when nothing listens on 127.0.0.1:<port>: we bind it for an instant, then let go. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host: LOOPBACK, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * A port no service row holds and that can be bound right now. Another process
 * may still take it before `docker run` does: the pipeline retries with a new
 * one when Docker reports the port as allocated.
 */
export async function allocateHostPort(exclude: ReadonlySet<number> = new Set()): Promise<number> {
  const rows = await db().service.findMany({
    where: { hostPort: { not: null } },
    select: { hostPort: true },
  });
  const taken = new Set<number>(exclude);
  for (const row of rows) if (row.hostPort !== null) taken.add(row.hostPort);

  const size = APP_PORT_RANGE.max - APP_PORT_RANGE.min + 1;
  const start = Math.floor(Math.random() * size);
  for (let offset = 0; offset < size; offset += 1) {
    const port = APP_PORT_RANGE.min + ((start + offset) % size);
    if (taken.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  throw unavailable("Aucun port libre n’est disponible sur le serveur pour ce service.");
}
