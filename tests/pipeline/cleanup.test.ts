/**
 * Deletions: the API only deletes rows and queues cleanup jobs; the worker's
 * jobs (src/server/jobs/handlers/cleanup.ts) remove the containers, volumes
 * and network. Run here the way the worker loop runs them.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { Project, Service } from "@/lib/types";
import { db } from "@/server/db";
import { JobRetry, runJob } from "@/server/jobs/handlers";
import type { JobPayloads } from "@/server/jobs/queue";

import {
  containersLabelled,
  createImageService,
  createProject,
  deployNow,
  DockerJanitor,
  dockerCli,
  envOf,
  inspect,
  networkExists,
  networksLabelled,
  ownerApi,
  removeDataDir,
  runDueJobs,
  serviceRow,
  volumesLabelled,
  waitFor,
  waitForRunningContainer,
  whileDeploying,
  WHOAMI,
} from "./helpers";

describe("pipeline: deletion cleanup", () => {
  const janitor = new DockerJanitor();
  let api: Api;
  let project: Project;
  let keeper: Service;

  async function deployWhoami(name: string, port: number = WHOAMI.port): Promise<{ service: Service; deploymentId: string }> {
    return createImageService(api, janitor, { projectId: project.id, image: WHOAMI.image, tag: WHOAMI.tag, name, port });
  }

  beforeAll(async () => {
    api = await ownerApi();
    project = await createProject(api, janitor, "pipetest-cleanup");
    const created = await deployWhoami("keeper");
    keeper = created.service;
    const row = await deployNow(created.deploymentId);
    if (row.status !== "active") throw new Error(`keeper deployment ended ${row.status}: ${row.error ?? ""}`);
  });

  afterAll(async () => {
    try {
      await janitor.sweep();
    } finally {
      await removeDataDir();
    }
  });

  it("deleting a service removes its container and its volume, and nothing of its neighbours", async () => {
    const { service, deploymentId } = await deployWhoami("store");
    await api.services.update(service.id, { volume: { mountPath: "/data", sizeGb: 1 } });
    const domain = await api.domains.generate(service.id);
    expect((await deployNow(deploymentId)).status).toBe("active");

    const live = await serviceRow(service.id);
    const volume = `mr-${service.id}-data`;
    expect(live.volumeName).toBe(volume);
    const container = await inspect(live.containerName ?? "");
    if (!container) throw new Error("the live container does not exist");
    // A named volume is the only mount, never a host path.
    expect(container.Mounts).toEqual([
      expect.objectContaining({ Type: "volume", Name: volume, Destination: "/data" }),
    ]);
    expect(envOf(container)).toMatchObject({ TWINS_VOLUME_NAME: volume, TWINS_VOLUME_MOUNT_PATH: "/data" });
    expect(await volumesLabelled(service.id)).toEqual([volume]);

    await api.services.delete(service.id);
    expect(await db().service.findUnique({ where: { id: service.id } })).toBeNull();
    // The API never touches Docker: the container is still there until the job runs.
    expect((await inspect(live.containerName ?? ""))?.State.Running).toBe(true);
    const job = await db().job.findFirst({ where: { type: "cleanup.service", status: "pending" } });
    expect(job?.payload).toMatchObject({
      serviceId: service.id,
      projectId: project.id,
      containerName: live.containerName,
      volumeName: volume,
      hostnames: [domain.hostname],
      imageRepository: null,
      repoDir: null,
    });

    const ran = await runDueJobs();
    expect(ran).toEqual([{ id: job?.id, type: "cleanup.service", error: null }]);
    expect((await db().job.findUniqueOrThrow({ where: { id: job?.id ?? "" } })).status).toBe("done");
    expect(await containersLabelled("service", service.id)).toEqual([]);
    expect(await volumesLabelled(service.id)).toEqual([]);
    expect((await dockerCli(["volume", "inspect", volume])).code).not.toBe(0);

    // The rest of the project is untouched.
    const neighbour = await serviceRow(keeper.id);
    expect((await inspect(neighbour.containerName ?? ""))?.State.Running).toBe(true);
    expect(await networkExists(`mr-${project.id}`)).toBe(true);
  });

  it("deleting a service in the middle of its deployment leaves nothing behind", async () => {
    // Port 8081: whoami listens on 80, so the health check keeps waiting.
    const { service, deploymentId } = await deployWhoami("ephemeral", 8081);
    let container = "";
    await whileDeploying(deploymentId, async ({ done }) => {
      container = await waitForRunningContainer(deploymentId);
      await api.services.delete(service.id);
      // The heartbeat finds the row gone: the run stops by itself, well before the 60 s health timeout.
      const startedWaiting = Date.now();
      await done;
      expect(Date.now() - startedWaiting).toBeLessThan(15_000);
    });
    expect(await inspect(container)).toBeNull();
    expect(await db().deployment.findUnique({ where: { id: deploymentId } })).toBeNull();

    const ran = await runDueJobs();
    expect(ran.map((outcome) => [outcome.type, outcome.error])).toEqual([["cleanup.service", null]]);
    expect(await containersLabelled("service", service.id)).toEqual([]);
    expect(await volumesLabelled(service.id)).toEqual([]);
  });

  it("deleting the project removes the network once its services are cleaned", async () => {
    const keeperRow = await serviceRow(keeper.id);
    await api.projects.delete(project.id);
    expect(await db().project.findUnique({ where: { id: project.id } })).toBeNull();

    // The network job is due a few seconds later; run too early it asks for a retry (containers attached).
    const networkJob = await db().job.findFirstOrThrow({ where: { type: "cleanup.project", status: "pending" } });
    expect(networkJob.runAt.getTime()).toBeGreaterThan(Date.now());
    await expect(
      runJob({
        id: networkJob.id,
        type: "cleanup.project",
        payload: networkJob.payload as unknown as JobPayloads["cleanup.project"],
        attempts: 1,
      }),
    ).rejects.toBeInstanceOf(JobRetry);
    expect(await networkExists(`mr-${project.id}`)).toBe(true);

    const services = await runDueJobs();
    expect(services.map((outcome) => [outcome.type, outcome.error])).toEqual([["cleanup.service", null]]);
    expect(await inspect(keeperRow.containerName ?? "")).toBeNull();

    // Then the network job, once due, as the worker would pick it up.
    const network = await waitFor("the network cleanup to run", async () => {
      const ran = await runDueJobs();
      return ran.length > 0 ? ran : null;
    }, 30_000);
    expect(network).toEqual([{ id: networkJob.id, type: "cleanup.project", error: null }]);
    expect(await networkExists(`mr-${project.id}`)).toBe(false);
    expect(await networksLabelled(project.id)).toEqual([]);
    expect(await containersLabelled("project", project.id)).toEqual([]);
    expect(await db().job.count({ where: { status: { not: "done" } } })).toBe(0);
  });
});
