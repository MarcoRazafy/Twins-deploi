/**
 * Image deployments end to end with real Docker: first deployment, redeploy,
 * failed deployment that keeps the previous container, rollback.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { Project, Service } from "@/lib/types";
import { PROXY_NOT_CONFIGURED } from "@/server/proxy";

import {
  createImageService,
  createProject,
  deployNow,
  deploymentRow,
  DockerJanitor,
  containersLabelled,
  envOf,
  externalIPv4,
  httpGet,
  inspect,
  LABEL_DEPLOYMENT,
  LABEL_MANAGED,
  LABEL_PROJECT,
  LABEL_SERVICE,
  MISSING_IMAGE,
  ownerApi,
  removeDataDir,
  runOnProjectNetwork,
  serviceRow,
  tcpAccepts,
  WHOAMI,
} from "./helpers";

const MB = 1024 * 1024;

describe("pipeline: Docker image service", () => {
  const janitor = new DockerJanitor();
  let api: Api;
  let project: Project;
  let service: Service;
  let firstDeploymentId = "";

  beforeAll(async () => {
    api = await ownerApi();
    project = await createProject(api, janitor, "pipetest-image");
  });

  afterAll(async () => {
    try {
      await janitor.sweep();
    } finally {
      await removeDataDir();
    }
  });

  it("deploys an image: live container, hardening, environment, network, loopback port, logs, domain", async () => {
    const created = await createImageService(api, janitor, {
      projectId: project.id,
      image: WHOAMI.image,
      tag: WHOAMI.tag,
      name: "whoami",
      port: WHOAMI.port,
    });
    service = created.service;
    firstDeploymentId = created.deploymentId;
    expect(service.status).toBe("building");
    expect((await api.deployments.get(created.deploymentId)).status).toBe("queued");

    await api.services.update(service.id, { config: { memoryLimitMb: 192, cpuLimit: 0.5, restartPolicy: "always" } });
    const domain = await api.domains.generate(service.id);
    expect(domain.kind).toBe("generated");
    // No container yet: the generated domain waits.
    expect(domain.status).toBe("verifying");
    expect(domain.hostname).toMatch(/\.platform\.test$/);

    const row = await deployNow(created.deploymentId);
    expect(row.status).toBe("active");
    expect(row.error).toBeNull();
    expect(row.progress).toBe(100);
    expect(row.image).toBe("traefik/whoami:latest");
    expect(row.finishedAt).not.toBeNull();
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect((await api.deployments.get(row.id)).status).toBe("active");

    const live = await serviceRow(service.id);
    expect(live.status).toBe("online");
    expect((await api.services.get(service.id)).status).toBe("online");
    expect(live.activeDeploymentId).toBe(row.id);
    expect(live.latestDeploymentId).toBe(row.id);
    expect(live.containerName).toMatch(/^mr-pipetest-image-whoami-[0-9a-f]{6}$/);
    expect(live.hostPort).not.toBeNull();
    const hostPort = live.hostPort ?? 0;
    expect(hostPort).toBeGreaterThanOrEqual(20_000);
    expect(hostPort).toBeLessThanOrEqual(29_999);

    const container = await inspect(live.containerName ?? "");
    if (!container) throw new Error("the live container does not exist");
    expect(container.State.Running).toBe(true);
    expect(container.Id).toBe(live.containerId);

    // Labels: how the platform finds its containers again.
    expect(container.Config.Labels).toMatchObject({
      [LABEL_MANAGED]: "true",
      [LABEL_PROJECT]: project.id,
      [LABEL_SERVICE]: service.id,
      [LABEL_DEPLOYMENT]: row.id,
    });

    // Hardening (docs/BACKEND.md section 8).
    const host = container.HostConfig;
    expect(host.Privileged).toBe(false);
    expect(host.Memory).toBe(192 * MB);
    expect(host.NanoCpus).toBe(0.5e9);
    expect(host.RestartPolicy.Name).toBe("always");
    expect(host.PidsLimit).toBe(512);
    expect(host.SecurityOpt ?? []).toContain("no-new-privileges");
    expect((host.CapDrop ?? []).some((cap) => /NET_RAW$/.test(cap))).toBe(true);
    expect(host.CapAdd ?? []).toEqual([]);
    expect(host.Binds ?? []).toEqual([]);
    expect(container.Mounts).toEqual([]);
    expect(host.NetworkMode).toBe(`mr-${project.id}`);

    // Published on the loopback only, on the recorded port.
    expect(Object.keys(host.PortBindings ?? {})).toEqual(["80/tcp"]);
    expect(host.PortBindings?.["80/tcp"]).toEqual([{ HostIp: "127.0.0.1", HostPort: String(hostPort) }]);
    const answer = await httpGet(hostPort, "/");
    expect(answer.status).toBe(200);
    expect(answer.body).toContain("Hostname:");
    const external = externalIPv4();
    if (external !== null) expect(await tcpAccepts(external, hostPort)).toBe(false);

    // Private network: the aliases, and the private domain actually resolves.
    const attachment = container.NetworkSettings.Networks[`mr-${project.id}`];
    expect(attachment).toBeDefined();
    const names = new Set([...(attachment?.Aliases ?? []), ...(attachment?.DNSNames ?? [])]);
    for (const alias of ["whoami", "whoami.twinsdeploi.internal", "whoami.railway.internal"]) {
      expect(names.has(alias), alias).toBe(true);
    }
    const viaNetwork = await runOnProjectNetwork(project.id, ["wget", "-qO-", "http://whoami.twinsdeploi.internal/"]);
    expect(viaNetwork.code, viaNetwork.stderr).toBe(0);
    expect(viaNetwork.stdout).toContain("Hostname:");

    // Platform variables.
    const env = envOf(container);
    expect(env).toMatchObject({
      PORT: "80",
      TWINS_PROJECT_ID: project.id,
      TWINS_PROJECT_NAME: "pipetest-image",
      TWINS_SERVICE_ID: service.id,
      TWINS_SERVICE_NAME: "whoami",
      TWINS_DEPLOYMENT_ID: row.id,
      TWINS_PRIVATE_DOMAIN: "whoami.twinsdeploi.internal",
      TWINS_PUBLIC_DOMAIN: domain.hostname,
      TWINS_ENVIRONMENT_NAME: project.environment,
      TWINS_REGION: project.region,
    });
    expect(env).not.toHaveProperty("TWINS_VOLUME_NAME");
    // The 0600 env file lives only for the `docker run`.
    expect(existsSync(path.join(process.env.MINI_RAILWAY_DATA_DIR ?? "", "tmp", `${row.id}.env`))).toBe(false);

    // Logs: every step, in order, on the right stream.
    const logs = await api.deployments.getLogs(row.id);
    const expected: Array<[RegExp, "build" | "deploy"]> = [
      [new RegExp(`^Deployment ${row.id} of whoami started \\(trigger: initial\\)$`), "build"],
      [/^Pulling image traefik\/whoami:latest$/, "build"],
      [/^Image traefik\/whoami:latest is ready$/, "build"],
      [new RegExp(`^Network mr-${project.id} ready$`), "deploy"],
      [/^Injecting \d+ environment variables$/, "deploy"],
      [new RegExp(`^Starting container ${live.containerName} \\(127\\.0\\.0\\.1:${hostPort} -> 80\\)$`), "deploy"],
      [new RegExp(`^Waiting for the container to be healthy \\(TCP 127\\.0\\.0\\.1:${hostPort}, up to 60s\\)$`), "deploy"],
      [/^Health check passed$/, "deploy"],
      [/^Switching traffic to the new container$/, "deploy"],
      [/^Deployment successful$/, "deploy"],
    ];
    let previous = -1;
    for (const [pattern, stream] of expected) {
      const index = logs.findIndex((line) => pattern.test(line.message));
      expect(index, String(pattern)).toBeGreaterThan(previous);
      expect(logs[index]?.stream, String(pattern)).toBe(stream);
      previous = index;
    }
    expect(logs.filter((line) => line.level === "error")).toEqual([]);

    // The pipeline published the domains after the switch. The privileged
    // helpers are disabled in tests, so the attempt is recorded as an error
    // naming the missing proxy (with them, the domain would be "active").
    const [published] = await api.domains.list({ serviceId: service.id });
    expect(published?.id).toBe(domain.id);
    expect(published?.status).toBe("error");
    expect(published?.error).toBe(PROXY_NOT_CONFIGURED);
    expect(published?.lastCheckedAt).not.toBeNull();

    const activity = await api.activity.list({ projectId: project.id });
    expect(activity.some((event) => event.type === "deployment.succeeded" && event.deploymentId === row.id)).toBe(true);
  });

  it("redeploys: a new container replaces the old one, the old deployment becomes removed", async () => {
    const before = await serviceRow(service.id);
    const second = await api.deployments.trigger(service.id, { trigger: "redeploy" });
    expect(second.status).toBe("queued");
    expect((await serviceRow(service.id)).status).toBe("building");
    // Still serving while the new deployment waits.
    expect((await inspect(before.containerName ?? ""))?.State.Running).toBe(true);

    const row = await deployNow(second.id);
    expect(row.status).toBe("active");

    const after = await serviceRow(service.id);
    expect(after.status).toBe("online");
    expect(after.activeDeploymentId).toBe(second.id);
    expect(after.containerName).not.toBe(before.containerName);
    expect(await inspect(before.containerName ?? "")).toBeNull();
    expect((await deploymentRow(firstDeploymentId)).status).toBe("removed");

    const containers = await containersLabelled("service", service.id);
    expect(containers).toEqual([{ name: after.containerName, state: "running" }]);
    const container = await inspect(after.containerName ?? "");
    expect(container && envOf(container).TWINS_DEPLOYMENT_ID).toBe(second.id);
    expect((await httpGet(after.hostPort ?? 0, "/")).status).toBe(200);
  });

  it("a failed deployment (missing image) keeps the previous container serving", async () => {
    const before = await serviceRow(service.id);
    await api.services.update(service.id, { source: { image: MISSING_IMAGE.image, tag: MISSING_IMAGE.tag } });
    const third = await api.deployments.trigger(service.id, { trigger: "manual" });
    expect(third.image).toBe("twinsdeploi-test/does-not-exist:1");

    const row = await deployNow(third.id);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("L’image twinsdeploi-test/does-not-exist:1 est introuvable ou son accès est refusé.");
    expect(row.finishedAt).not.toBeNull();

    const after = await serviceRow(service.id);
    expect(after.status).toBe("online");
    expect(after.activeDeploymentId).toBe(before.activeDeploymentId);
    expect(after.latestDeploymentId).toBe(third.id);
    expect(after.containerName).toBe(before.containerName);
    expect(after.hostPort).toBe(before.hostPort);
    expect((await deploymentRow(before.activeDeploymentId ?? "")).status).toBe("active");
    expect((await inspect(before.containerName ?? ""))?.State.Running).toBe(true);
    expect((await httpGet(before.hostPort ?? 0, "/")).status).toBe(200);
    expect(await containersLabelled("deployment", third.id)).toEqual([]);

    const messages = (await api.deployments.getLogs(third.id)).map((line) => line.message);
    expect(messages).toContain("Pulling image twinsdeploi-test/does-not-exist:1");
    expect(messages).toContain("Deployment failed");
    const activity = await api.activity.list({ projectId: project.id });
    expect(activity.some((event) => event.type === "deployment.failed" && event.deploymentId === third.id)).toBe(true);
  });

  it("rolls back to a removed deployment, reusing its image", async () => {
    const rollback = await api.deployments.rollback(firstDeploymentId);
    expect(rollback.trigger).toBe("rollback");
    expect(rollback.image).toBe("traefik/whoami:latest");

    const row = await deployNow(rollback.id);
    expect(row.status).toBe("active");
    const after = await serviceRow(service.id);
    expect(after.activeDeploymentId).toBe(rollback.id);
    expect(after.status).toBe("online");
    expect((await httpGet(after.hostPort ?? 0, "/")).status).toBe(200);
    expect(await containersLabelled("service", service.id)).toEqual([{ name: after.containerName, state: "running" }]);
  });
});
