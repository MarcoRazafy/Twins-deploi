/**
 * The worker keeping the database in line with reality:
 * - recoverInterruptedDeployments (src/server/deploy/recovery.ts): in-flight
 *   deployments without a recent heartbeat are failed with INTERRUPTED_ERROR,
 *   the container they created is removed, the service gets its status back;
 * - reconcileContainers (src/server/monitor/reconcile.ts): a live container
 *   that stopped or vanished marks the service crashed, one that runs again
 *   brings it back online.
 */

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { Deployment as DeploymentRow } from "@/generated/prisma/client";
import type { Project, Service } from "@/lib/types";
import { db } from "@/server/db";
import { INTERRUPTED_ERROR } from "@/server/deploy/pipeline";
import { recoverInterruptedDeployments } from "@/server/deploy/recovery";
import { newId } from "@/server/ids";
import { reconcileContainers } from "@/server/monitor/reconcile";

import {
  containersLabelled,
  createImageService,
  createProject,
  deployNow,
  deploymentRow,
  DockerJanitor,
  dockerCli,
  inspect,
  LABEL_DEPLOYMENT,
  LABEL_MANAGED,
  LABEL_PROJECT,
  LABEL_SERVICE,
  ownerApi,
  removeDataDir,
  serviceRow,
  waitFor,
  WHOAMI,
} from "./helpers";

const STALE_AFTER_MS = 10_000;

describe("pipeline: recovery and container monitor", () => {
  const janitor = new DockerJanitor();
  let api: Api;
  let project: Project;
  let service: Service;
  let activeId = "";

  /** An in-flight deployment row as a worker would have left it, the service marked accordingly. */
  async function inFlightRow(status: "building" | "deploying", heartbeatAgoMs: number): Promise<DeploymentRow> {
    const at = new Date(Date.now() - heartbeatAgoMs);
    const row = await db().deployment.create({
      data: {
        id: newId("dep"),
        projectId: project.id,
        serviceId: service.id,
        status,
        trigger: "manual",
        creator: "pipeline test",
        image: `${WHOAMI.image}:${WHOAMI.tag}`,
        progress: status === "building" ? 10 : 80,
        createdAt: at,
        startedAt: at,
        heartbeatAt: at,
        lockedBy: "dead-worker:1",
      },
    });
    await db().service.update({ where: { id: service.id }, data: { status, latestDeploymentId: row.id } });
    return row;
  }

  beforeAll(async () => {
    api = await ownerApi();
    project = await createProject(api, janitor, "pipetest-recovery");
    const created = await createImageService(api, janitor, {
      projectId: project.id,
      image: WHOAMI.image,
      tag: WHOAMI.tag,
      name: "app",
      port: WHOAMI.port,
    });
    service = created.service;
    activeId = created.deploymentId;
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

  it("fails a deployment whose heartbeat stopped, removes its container, keeps the live one", async () => {
    const live = await serviceRow(service.id);
    const stale = await inFlightRow("deploying", 5 * 60_000);
    // The container the dead worker had started for it.
    const orphan = `mr-pipetest-recovery-app-${randomBytes(3).toString("hex")}`;
    const started = await dockerCli([
      "run", "-d", "--name", orphan, "--memory", "64m", "--pull", "never",
      "--label", `${LABEL_MANAGED}=true`,
      "--label", `${LABEL_PROJECT}=${project.id}`,
      "--label", `${LABEL_SERVICE}=${service.id}`,
      "--label", `${LABEL_DEPLOYMENT}=${stale.id}`,
      `${WHOAMI.image}:${WHOAMI.tag}`,
    ]);
    expect(started.code, started.stderr).toBe(0);

    expect(await recoverInterruptedDeployments(STALE_AFTER_MS)).toEqual([stale.id]);

    const row = await deploymentRow(stale.id);
    expect(row.status).toBe("failed");
    expect(row.error).toBe(INTERRUPTED_ERROR);
    expect(row.finishedAt).not.toBeNull();
    const logs = await api.deployments.getLogs(stale.id);
    expect(logs.map((line) => [line.level, line.stream, line.message])).toContainEqual([
      "error",
      "deploy",
      "Deployment interrupted by a platform restart",
    ]);
    expect(await inspect(orphan)).toBeNull();

    const after = await serviceRow(service.id);
    expect(after.status).toBe("online");
    expect(after.activeDeploymentId).toBe(activeId);
    expect((await inspect(live.containerName ?? ""))?.State.Running).toBe(true);
    expect((await deploymentRow(activeId)).status).toBe("active");
    const activity = await api.activity.list({ projectId: project.id });
    expect(activity.some((event) => event.type === "deployment.failed" && event.deploymentId === stale.id)).toBe(true);
  });

  it("leaves alone a deployment with a recent heartbeat and the one this worker runs", async () => {
    const fresh = await inFlightRow("building", 0);
    const mine = await inFlightRow("deploying", 5 * 60_000);

    expect(await recoverInterruptedDeployments(STALE_AFTER_MS, mine.id)).toEqual([]);
    expect((await deploymentRow(fresh.id)).status).toBe("building");
    expect((await deploymentRow(mine.id)).status).toBe("deploying");
    expect((await serviceRow(service.id)).status).toBe("deploying");

    // At startup (staleness 0, nothing excluded) both are interrupted; the service then settles.
    const recovered = await recoverInterruptedDeployments(0);
    expect([...recovered].sort()).toEqual([fresh.id, mine.id].sort());
    expect((await serviceRow(service.id)).status).toBe("online");
  });

  it("marks the service crashed when its container stops, online again when it runs", async () => {
    const live = await serviceRow(service.id);
    const name = live.containerName ?? "";
    expect((await dockerCli(["stop", "-t", "1", name])).code).toBe(0);

    expect(await reconcileContainers()).toBe(1);
    const crashed = await serviceRow(service.id);
    expect(crashed.status).toBe("crashed");
    const deployment = await deploymentRow(activeId);
    expect(deployment.status).toBe("crashed");
    expect(deployment.error).toMatch(/^Le conteneur s’est arrêté \(code de sortie -?\d+\)\.$/);
    // The restart policy (on-failure) does not restart a container stopped on purpose.
    expect((await inspect(name))?.State.Running).toBe(false);

    expect((await dockerCli(["start", name])).code).toBe(0);
    await waitFor("the container to run again", async () => (await inspect(name))?.State.Running === true);
    await reconcileContainers();
    const back = await serviceRow(service.id);
    expect(back.status).toBe("online");
    expect(back.restartCount).toBe(1);
    const restored = await deploymentRow(activeId);
    expect(restored.status).toBe("active");
    expect(restored.error).toBeNull();

    const types = (await api.activity.list({ projectId: project.id })).map((event) => event.type);
    expect(types).toContain("service.crashed");
    expect(types).toContain("service.restarted");
  });

  it("marks the service crashed when its container vanished", async () => {
    const live = await serviceRow(service.id);
    expect((await dockerCli(["rm", "-f", live.containerName ?? ""])).code).toBe(0);

    await reconcileContainers();
    expect((await serviceRow(service.id)).status).toBe("crashed");
    const deployment = await deploymentRow(activeId);
    expect(deployment.status).toBe("crashed");
    expect(deployment.error).toBe("Le conteneur du service n’existe plus.");
    expect(await containersLabelled("service", service.id)).toEqual([]);
  });
});
