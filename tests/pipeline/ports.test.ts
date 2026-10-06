/**
 * Host ports (src/server/deploy/ports.ts): a port is handed out only when no
 * service row holds it AND nothing on the machine listens on 127.0.0.1:<port>
 * (other platforms, the production containers running next to the tests).
 */

import net from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import { db } from "@/server/db";
import { allocateHostPort, isPortFree } from "@/server/deploy/ports";
import { APP_PORT_RANGE } from "@/server/proxy";

import { createImageService, createProject, DockerJanitor, ownerApi, removeDataDir, WHOAMI } from "./helpers";

function listen(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => resolve(server));
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Every port of the range except `keep`. */
function allBut(keep: readonly number[]): Set<number> {
  const excluded = new Set<number>();
  for (let port = APP_PORT_RANGE.min; port <= APP_PORT_RANGE.max; port += 1) {
    if (!keep.includes(port)) excluded.add(port);
  }
  return excluded;
}

describe("pipeline: host port allocation", () => {
  const janitor = new DockerJanitor();
  let api: Api;
  const candidates: number[] = [];

  beforeAll(async () => {
    api = await ownerApi();
    for (let port = APP_PORT_RANGE.max; port >= APP_PORT_RANGE.min && candidates.length < 3; port -= 1) {
      if (await isPortFree(port)) candidates.push(port);
    }
    if (candidates.length < 3) throw new Error("not enough free ports to test the allocation");
  });

  afterAll(async () => {
    try {
      await janitor.sweep();
    } finally {
      await removeDataDir();
    }
  });

  it("skips a port another process listens on and a port a service holds", async () => {
    const [busy, held, free] = candidates;
    const project = await createProject(api, janitor, "pipetest-ports");
    const { service } = await createImageService(api, janitor, {
      projectId: project.id,
      image: WHOAMI.image,
      tag: WHOAMI.tag,
      name: "holder",
      port: WHOAMI.port,
    });
    await db().service.update({ where: { id: service.id }, data: { hostPort: held } });

    const server = await listen(busy);
    try {
      expect(await isPortFree(busy)).toBe(false);
      expect(await allocateHostPort(allBut([busy, held, free]))).toBe(free);
      // Nothing left: the French "no free port" error.
      await expect(allocateHostPort(allBut([busy, held]))).rejects.toThrow(
        "Aucun port libre n’est disponible sur le serveur pour ce service.",
      );
    } finally {
      await close(server);
    }
    expect(await allocateHostPort(allBut([busy, held]))).toBe(busy);
  });
});
