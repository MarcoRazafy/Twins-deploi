/**
 * Containers that never become healthy: a health check path answering 404
 * (waits the full 60 s of the pipeline), a container exiting at startup.
 * Both end failed with a French reason, the container's last lines in the
 * deployment logs and nothing left in Docker.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { Project } from "@/lib/types";

import {
  containersLabelled,
  createImageService,
  createProject,
  deployNow,
  DockerJanitor,
  NGINX,
  ownerApi,
  removeDataDir,
  serviceRow,
} from "./helpers";

describe("pipeline: unhealthy containers", () => {
  const janitor = new DockerJanitor();
  let api: Api;
  let project: Project;

  beforeAll(async () => {
    api = await ownerApi();
    project = await createProject(api, janitor, "pipetest-health");
  });

  afterAll(async () => {
    try {
      await janitor.sweep();
    } finally {
      await removeDataDir();
    }
  });

  it("fails when the health check path answers 404, with the container logs captured", async () => {
    const { service, deploymentId } = await createImageService(api, janitor, {
      projectId: project.id,
      image: NGINX.image,
      tag: NGINX.tag,
      name: "nope",
      port: NGINX.port,
    });
    await api.services.update(service.id, { config: { healthcheckPath: "/nope" } });

    const started = Date.now();
    const row = await deployNow(deploymentId);
    // HEALTH_TIMEOUT_MS of the pipeline is 60 s.
    expect(Date.now() - started).toBeGreaterThanOrEqual(60_000);
    expect(row.status).toBe("failed");
    expect(row.error).toBe(
      "Le contrôle de santé n’a pas abouti en 60 secondes : GET /nope sur le port 80 ne renvoie pas de réponse 2xx ou 3xx (service injoignable, ou chemin inexistant).",
    );

    const logs = await api.deployments.getLogs(deploymentId);
    const messages = logs.map((line) => line.message);
    expect(messages.some((message) => /^Waiting for the container to be healthy \(GET http:\/\/127\.0\.0\.1:\d+\/nope, up to 60s\)$/.test(message))).toBe(true);
    expect(messages).toContain("Health check did not pass within 60s");
    expect(messages.some((message) => /^Last \d+ lines of the container:$/.test(message))).toBe(true);
    // nginx's access log, as captured from the container before its removal.
    expect(messages.some((message) => message.includes('"GET /nope HTTP/1.1" 404'))).toBe(true);
    expect(messages).toContain("Deployment failed");

    expect(await containersLabelled("service", service.id)).toEqual([]);
    const after = await serviceRow(service.id);
    // First deployment: nothing was ever live.
    expect(after.status).toBe("crashed");
    expect(after.activeDeploymentId).toBeNull();
    expect(after.containerName).toBeNull();
    expect(after.hostPort).toBeNull();
    expect((await api.services.get(service.id)).status).toBe("crashed");
  });

  it("fails fast when the container exits during startup", async () => {
    const { service, deploymentId } = await createImageService(api, janitor, {
      projectId: project.id,
      image: NGINX.image,
      tag: NGINX.tag,
      name: "crash",
      port: NGINX.port,
    });
    await api.services.update(service.id, {
      config: { startCommand: "echo boot-failure-marker >&2; exit 3" },
    });

    const started = Date.now();
    const row = await deployNow(deploymentId);
    expect(Date.now() - started).toBeLessThan(45_000);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("Le conteneur s’est arrêté pendant son démarrage (code de sortie 3).");

    const logs = await api.deployments.getLogs(deploymentId);
    expect(logs.some((line) => line.message === "Container exited during startup (exit code 3)")).toBe(true);
    expect(logs.some((line) => line.level === "error" && line.message === "boot-failure-marker")).toBe(true);
    expect(await containersLabelled("service", service.id)).toEqual([]);
    expect((await serviceRow(service.id)).status).toBe("crashed");
  });
});
