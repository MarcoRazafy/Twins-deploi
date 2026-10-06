import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Api } from "@/lib/api/contract";
import { db } from "@/server/db";
import { resolveBranchTip } from "@/server/git/repository";
import { resetDatabase } from "../helpers/db";
import { apiAs, deployImage, expectApiError, setupOwner } from "../helpers/api";

// github.importRepo without a GitHub connection reads the branch tip with
// `git ls-remote` (network): only that call is replaced, the rest is real.
vi.mock("@/server/git/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/git/repository")>()),
  resolveBranchTip: vi.fn(),
}));

const TIP = "0123456789abcdef0123456789abcdef01234567";
let api: Api;
let projectId: string;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(resolveBranchTip).mockReset().mockResolvedValue(TIP);
  api = apiAs(await setupOwner());
  projectId = (await api.projects.create({ name: "Services" })).id;
});

describe("docker.deployImage", () => {
  it("creates the service and queues its first deployment (no Docker involved)", async () => {
    const service = await api.docker.deployImage({
      projectId,
      image: "redis:7-alpine",
      variables: [{ key: "REDIS_ARGS", value: "--save 60 1" }],
    });
    expect(service).toMatchObject({
      name: "redis",
      status: "building",
      source: { type: "docker", image: "redis", tag: "7-alpine" },
      config: { port: 6379, replicas: 1, memoryLimitMb: 512, cpuLimit: 1 },
      volume: null,
    });
    const deployments = await api.deployments.list({ serviceId: service.id });
    expect(deployments).toHaveLength(1);
    expect(deployments[0]).toMatchObject({ status: "queued", trigger: "initial", image: "redis:7-alpine" });
    expect(service.latestDeploymentId).toBe(deployments[0].id);
    const variables = await api.variables.list({ serviceId: service.id });
    expect(variables.map((variable) => [variable.key, variable.value])).toEqual([["REDIS_ARGS", "--save 60 1"]]);
  });

  it("suffixes a derived name, refuses a taken explicit one, validates the input", async () => {
    const first = await api.docker.deployImage({ projectId, image: "nginx" });
    const second = await api.docker.deployImage({ projectId, image: "nginx" });
    expect([first.name, second.name]).toEqual(["nginx", "nginx-2"]);
    expect(second.position).not.toEqual(first.position);

    await expectApiError(deployImage(api, projectId, "NGINX"), "conflict", "name");
    await expectApiError(api.docker.deployImage({ projectId, image: "Not An Image" }), "validation", "image");
    await expectApiError(api.docker.deployImage({ projectId, image: "nginx", port: 70000 }), "validation", "port");
    await expectApiError(
      api.docker.deployImage({ projectId, image: "nginx", variables: [{ key: "TWINS_X", value: "1" }] }),
      "validation",
      "key",
    );
    await expectApiError(api.docker.deployImage({ projectId: "prj_missing", image: "nginx" }), "not_found");
  });
});

describe("github.importRepo", () => {
  it("creates a GitHub service from a public repository and queues the tip commit", async () => {
    const service = await api.github.importRepo({ projectId, repo: "acme/shop-api", branch: "main", rootDirectory: "/apps/api/" });
    expect(resolveBranchTip).toHaveBeenCalledWith("acme/shop-api", "main");
    expect(service).toMatchObject({
      name: "shop-api",
      status: "building",
      source: { type: "github", repo: "acme/shop-api", branch: "main", rootDirectory: "/apps/api", autoDeploy: true },
      config: { port: 3000, builder: "nixpacks" },
    });
    const [deployment] = await api.deployments.list({ serviceId: service.id });
    expect(deployment).toMatchObject({ status: "queued", trigger: "initial" });
    expect(deployment.commit).toMatchObject({ sha: TIP, branch: "main" });
    const keys = (await api.variables.list({ serviceId: service.id })).map((variable) => variable.key).sort();
    expect(keys).toEqual(["NODE_ENV", "PORT"]);
  });

  it("validates before reaching the network", async () => {
    await expectApiError(api.github.importRepo({ projectId, repo: "no-slash", branch: "main" }), "validation", "repo");
    await expectApiError(api.github.importRepo({ projectId, repo: "acme/api", branch: "bad..branch" }), "validation", "branch");
    await expectApiError(api.github.importRepo({ projectId: "prj_missing", repo: "acme/api", branch: "main" }), "not_found");
    expect(resolveBranchTip).not.toHaveBeenCalled();

    vi.mocked(resolveBranchTip).mockResolvedValueOnce(null);
    await expectApiError(api.github.importRepo({ projectId, repo: "acme/api", branch: "nope" }), "validation", "branch");
    expect(await db().service.count()).toBe(0);
  });
});

describe("services.update", () => {
  it("applies config, source and volume changes without redeploying", async () => {
    const service = await deployImage(api, projectId, "web");
    const updated = await api.services.update(service.id, {
      config: { port: 9000, memoryLimitMb: 1024, replicas: 2, startCommand: "node server.js", healthcheckPath: "/health" },
      source: { tag: "1.28" },
      volume: { mountPath: "/data", sizeGb: 2 },
    });
    expect(updated.config).toMatchObject({ port: 9000, memoryLimitMb: 1024, replicas: 2, startCommand: "node server.js", healthcheckPath: "/health" });
    expect(updated.source).toEqual({ type: "docker", image: "nginx", tag: "1.28" });
    expect(updated.volume).toMatchObject({ mountPath: "/data", sizeGb: 2 });
    expect(await db().deployment.count({ where: { serviceId: service.id } })).toBe(1);

    const detached = await api.services.update(service.id, { volume: null });
    expect(detached.volume).toBeNull();
  });

  it("rejects the whole patch when one field is invalid", async () => {
    const service = await deployImage(api, projectId, "web");
    await expectApiError(api.services.update(service.id, { name: "renamed", config: { memoryLimitMb: 64 } }), "validation", "config.memoryLimitMb");
    await expectApiError(api.services.update(service.id, { config: { port: 0 } }), "validation", "config.port");
    await expectApiError(api.services.update(service.id, { config: { startCommand: "a\nb" } }), "validation", "config.startCommand");
    await expectApiError(api.services.update(service.id, { volume: { mountPath: "data", sizeGb: 1 } }), "validation", "volume.mountPath");
    expect((await api.services.get(service.id)).name).toBe("web");
    await expectApiError(api.services.update("svc_missing", {}), "not_found");
  });

  it("renames, keeps names unique and rewrites references to the old name", async () => {
    const web = await deployImage(api, projectId, "web");
    const worker = await deployImage(api, projectId, "worker");
    const ref = await api.variables.create({ projectId, serviceId: worker.id, key: "API", value: "http://${{web.TWINS_PRIVATE_DOMAIN}}" });

    await expectApiError(api.services.update(web.id, { name: "WORKER" }), "conflict", "name");
    const renamed = await api.services.update(web.id, { name: "frontend" });
    expect(renamed.name).toBe("frontend");
    const [rewritten] = await api.variables.list({ serviceId: worker.id });
    expect(rewritten).toMatchObject({ id: ref.id, value: "http://${{frontend.TWINS_PRIVATE_DOMAIN}}" });
  });
});

describe("services.updatePositions", () => {
  it("stores rounded positions and ignores garbage", async () => {
    const a = await deployImage(api, projectId, "aaa");
    const b = await deployImage(api, projectId, "bbb");
    await api.services.updatePositions({
      [a.id]: { x: 10.4, y: -20.6 },
      [b.id]: { x: "left", y: 5 } as never,
      svc_missing: { x: 1, y: 1 },
    });
    expect((await api.services.get(a.id)).position).toEqual({ x: 10, y: -21 });
    expect((await api.services.get(b.id)).position).toEqual(b.position);
  });
});

describe("services.start / stop", () => {
  it("cannot start a service that was never deployed; stop cancels the queued deployment", async () => {
    const service = await deployImage(api, projectId, "web");
    await expectApiError(api.services.start(service.id), "conflict");
    const stopped = await api.services.stop(service.id);
    expect(stopped.status).toBe("stopped");
    const [deployment] = await api.deployments.list({ serviceId: service.id });
    expect(deployment.status).toBe("cancelled");
    await expectApiError(api.services.start(service.id), "validation");
    expect(await db().job.count({ where: { type: "service.action" } })).toBe(1);
  });
});

describe("services.delete", () => {
  it("cascades to deployments, variables, domains, connections and the database", async () => {
    const web = await deployImage(api, projectId, "web");
    const other = await deployImage(api, projectId, "other");
    await api.variables.create({ projectId, serviceId: web.id, key: "OWN", value: "1" });
    await api.variables.create({ projectId, serviceId: null, key: "SHARED", value: "1" });
    await api.domains.generate(web.id);
    await api.services.connect({ fromServiceId: other.id, toServiceId: web.id });
    const database = await api.databases.create({ projectId });

    await api.services.delete(web.id);
    await api.services.delete(database.serviceId);

    const where = { serviceId: web.id };
    expect(await db().deployment.count({ where })).toBe(0);
    expect(await db().envVariable.count({ where })).toBe(0);
    expect(await db().domain.count({ where })).toBe(0);
    expect(await db().serviceConnection.count()).toBe(0);
    expect(await db().managedDatabase.count()).toBe(0);
    // Shared variables and the other service stay.
    expect((await api.variables.list({ projectId, serviceId: null })).map((v) => v.key)).toEqual(["SHARED"]);
    expect((await api.services.list({ projectId })).map((service) => service.id)).toEqual([other.id]);
    expect(await db().job.count({ where: { type: "cleanup.service" } })).toBe(2);
    expect(await db().activityEvent.count({ where })).toBe(0);
    await expectApiError(api.services.get(web.id), "not_found");
  });
});
