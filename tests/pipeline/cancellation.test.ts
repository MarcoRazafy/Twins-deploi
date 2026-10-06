/**
 * Deployments stopped while they run (see src/server/deployments/status.ts):
 * - a user cancel ends "cancelled" with CANCELLED_ERROR;
 * - a newer deployment of the same service ends the running one "cancelled"
 *   with SUPERSEDED_ERROR;
 * - the worker's shutdown signal ends it "failed" with INTERRUPTED_ERROR.
 * In every case the new container is removed and the live one keeps serving.
 *
 * "Never healthy" is obtained with a container port nothing listens on (whoami
 * listens on 80, the service says 8081); "stuck in the pull" with a registry
 * on an unroutable documentation address (RFC 5737).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { Project, Service } from "@/lib/types";
import { INTERRUPTED_ERROR } from "@/server/deploy/pipeline";
import { CANCELLED_ERROR, SUPERSEDED_ERROR } from "@/server/deployments/status";

import {
  containersLabelled,
  createImageService,
  createProject,
  deployNow,
  deploymentRow,
  DockerJanitor,
  httpGet,
  inspect,
  ownerApi,
  removeDataDir,
  serviceRow,
  waitFor,
  waitForRunningContainer,
  whileDeploying,
  WHOAMI,
} from "./helpers";

const UNREACHABLE_IMAGE = "192.0.2.1:5000/pipetest/slow";

describe("pipeline: cancellation and interruption", () => {
  const janitor = new DockerJanitor();
  let api: Api;
  let project: Project;
  let service: Service;

  /** The live container answers and is the one the service row points at. */
  async function expectLiveUnchanged(activeDeploymentId: string): Promise<void> {
    const live = await serviceRow(service.id);
    expect(live.status).toBe("online");
    expect(live.activeDeploymentId).toBe(activeDeploymentId);
    expect((await deploymentRow(activeDeploymentId)).status).toBe("active");
    expect((await inspect(live.containerName ?? ""))?.State.Running).toBe(true);
    expect((await httpGet(live.hostPort ?? 0, "/")).status).toBe(200);
  }

  async function messagesOf(deploymentId: string): Promise<string[]> {
    return (await api.deployments.getLogs(deploymentId)).map((line) => line.message);
  }

  beforeAll(async () => {
    api = await ownerApi();
    project = await createProject(api, janitor, "pipetest-cancel");
    const created = await createImageService(api, janitor, {
      projectId: project.id,
      image: WHOAMI.image,
      tag: WHOAMI.tag,
      name: "app",
      port: WHOAMI.port,
    });
    service = created.service;
    const row = await deployNow(created.deploymentId);
    if (row.status !== "active") throw new Error(`baseline deployment ended ${row.status}: ${row.error ?? ""}`);
  });

  afterAll(async () => {
    try {
      await janitor.sweep();
    } finally {
      await removeDataDir();
    }
  });

  it("a user cancel during the health check stops at once and removes the new container", async () => {
    const { activeDeploymentId } = await serviceRow(service.id);
    await api.services.update(service.id, { config: { port: 8081 } });
    const next = await api.deployments.trigger(service.id);

    let container = "";
    let cancelledAt = 0;
    await whileDeploying(next.id, async ({ done }) => {
      container = await waitForRunningContainer(next.id);
      cancelledAt = Date.now();
      const answer = await api.deployments.cancel(next.id);
      expect(["building", "deploying"]).toContain(answer.status);
      await done;
    });
    // Honoured at the next checkpoint (1 s health loop / 2 s heartbeat), not after the 60 s health timeout.
    expect(Date.now() - cancelledAt).toBeLessThan(15_000);

    const row = await deploymentRow(next.id);
    expect(row.status).toBe("cancelled");
    expect(row.error).toBe(CANCELLED_ERROR);
    expect(await inspect(container)).toBeNull();
    expect(await containersLabelled("deployment", next.id)).toEqual([]);
    expect(await messagesOf(next.id)).toContain("Deployment cancelled");
    await expectLiveUnchanged(activeDeploymentId ?? "");
  });

  it("a newer deployment supersedes the running one", async () => {
    // Port still 8081: the running deployment would never become healthy.
    const running = await api.deployments.trigger(service.id);
    let newerId = "";
    await whileDeploying(running.id, async ({ done }) => {
      await waitForRunningContainer(running.id);
      newerId = (await api.deployments.trigger(service.id, { trigger: "redeploy" })).id;
      await done;
    });
    const superseded = await deploymentRow(running.id);
    expect(superseded.status).toBe("cancelled");
    expect(superseded.error).toBe(SUPERSEDED_ERROR);
    expect(await containersLabelled("deployment", running.id)).toEqual([]);
    // The newer one is still waiting, the service still says so.
    expect((await deploymentRow(newerId)).status).toBe("queued");
    expect((await serviceRow(service.id)).status).toBe("building");

    // The configuration is read when the deployment runs: back to the real port.
    await api.services.update(service.id, { config: { port: WHOAMI.port } });
    expect((await deployNow(newerId)).status).toBe("active");
    await expectLiveUnchanged(newerId);
    expect((await containersLabelled("service", service.id)).length).toBe(1);
  });

  it("the worker shutting down during the health check fails the deployment as interrupted", async () => {
    const { activeDeploymentId } = await serviceRow(service.id);
    await api.services.update(service.id, { config: { port: 8081 } });
    const next = await api.deployments.trigger(service.id);

    let container = "";
    await whileDeploying(next.id, async ({ shutdown, done }) => {
      container = await waitForRunningContainer(next.id);
      shutdown.abort();
      await done;
    });
    await api.services.update(service.id, { config: { port: WHOAMI.port } });

    const row = await deploymentRow(next.id);
    expect(row.status).toBe("failed");
    expect(row.error).toBe(INTERRUPTED_ERROR);
    expect(await inspect(container)).toBeNull();
    expect(await containersLabelled("deployment", next.id)).toEqual([]);
    expect(await messagesOf(next.id)).toContain("Deployment interrupted: the platform is shutting down");
    await expectLiveUnchanged(activeDeploymentId ?? "");
  });

  it("the worker shutting down during the image pull kills the pull", async () => {
    const { activeDeploymentId } = await serviceRow(service.id);
    await api.services.update(service.id, { source: { image: UNREACHABLE_IMAGE, tag: "1" } });
    const next = await api.deployments.trigger(service.id);

    let abortedAt = 0;
    await whileDeploying(next.id, async ({ shutdown, done }) => {
      await waitFor("the pull to start", async () =>
        (await messagesOf(next.id)).includes(`Pulling image ${UNREACHABLE_IMAGE}:1`),
      );
      // The registry never answers (the daemon gives up after 30 s): the pull is still running.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect((await deploymentRow(next.id)).status).toBe("building");
      abortedAt = Date.now();
      shutdown.abort();
      await done;
    });
    expect(Date.now() - abortedAt).toBeLessThan(10_000);

    const row = await deploymentRow(next.id);
    expect(row.status).toBe("failed");
    expect(row.error).toBe(INTERRUPTED_ERROR);
    const messages = await messagesOf(next.id);
    expect(messages).toContain("Deployment interrupted: the platform is shutting down");
    expect(messages.some((message) => message.startsWith("Starting container"))).toBe(false);
    expect(await containersLabelled("deployment", next.id)).toEqual([]);
    await expectLiveUnchanged(activeDeploymentId ?? "");
  });
});
