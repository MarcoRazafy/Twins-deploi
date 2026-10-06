import { beforeEach, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { Service } from "@/lib/types";
import { db } from "@/server/db";
import { appendLogs } from "@/server/deployments/logs";
import { CANCELLED_ERROR, SUPERSEDED_ERROR } from "@/server/deployments/status";
import { resetDatabase } from "../helpers/db";
import { apiAs, deployImage, expectApiError, setupOwner } from "../helpers/api";

let api: Api;
let projectId: string;
let web: Service;

beforeEach(async () => {
  await resetDatabase();
  api = apiAs(await setupOwner());
  projectId = (await api.projects.create({ name: "Déploiements" })).id;
  web = await deployImage(api, projectId, "web");
});

/** The worker's side of the protocol, written directly: claims the queued deployment. */
async function markRunning(deploymentId: string, status: "building" | "deploying" = "building") {
  await db().deployment.update({ where: { id: deploymentId }, data: { status, startedAt: new Date() } });
}

describe("deployments.trigger", () => {
  it("queues a deployment and supersedes the queued one of the same service", async () => {
    const [initial] = await api.deployments.list({ serviceId: web.id });
    const next = await api.deployments.trigger(web.id);
    expect(next).toMatchObject({ status: "queued", trigger: "manual", serviceId: web.id, projectId, image: "nginx:1.27", creator: "Test Owner" });

    const previous = await api.deployments.get(initial.id);
    expect(previous).toMatchObject({ status: "cancelled", error: SUPERSEDED_ERROR });
    const service = await api.services.get(web.id);
    expect(service).toMatchObject({ status: "building", latestDeploymentId: next.id });
  });

  it("flags a running deployment for the worker instead of ending it", async () => {
    const [initial] = await api.deployments.list({ serviceId: web.id });
    await markRunning(initial.id);
    await api.deployments.trigger(web.id, { trigger: "redeploy" });
    const row = await db().deployment.findUniqueOrThrow({ where: { id: initial.id } });
    expect(row).toMatchObject({ status: "building", cancelRequested: true });
  });

  it("does not touch the deployments of other services", async () => {
    const other = await deployImage(api, projectId, "other");
    await api.deployments.trigger(web.id);
    const [otherDeployment] = await api.deployments.list({ serviceId: other.id });
    expect(otherDeployment.status).toBe("queued");
  });

  it("refuses internal triggers and unknown services", async () => {
    await expectApiError(api.deployments.trigger(web.id, { trigger: "initial" as never }), "validation", "trigger");
    await expectApiError(api.deployments.trigger("svc_missing"), "not_found");
  });
});

describe("deployments.list / get", () => {
  it("lists newest first, filtered by project, service, status and limit", async () => {
    const other = await deployImage(api, projectId, "other");
    const second = await api.deployments.trigger(web.id);
    const third = await api.deployments.trigger(web.id);

    const forWeb = await api.deployments.list({ serviceId: web.id });
    expect(forWeb.map((d) => d.id).slice(0, 2)).toEqual([third.id, second.id]);
    expect(forWeb).toHaveLength(3);
    expect(await api.deployments.list({ projectId })).toHaveLength(4);
    expect((await api.deployments.list({ statuses: ["queued"] })).map((d) => d.serviceId).sort()).toEqual([other.id, web.id].sort());
    expect(await api.deployments.list({ serviceId: web.id, statuses: ["cancelled"] })).toHaveLength(2);
    expect(await api.deployments.list({ statuses: ["bogus" as never] })).toEqual([]);
    expect(await api.deployments.list({ limit: 1 })).toHaveLength(1);

    expect((await api.deployments.get(third.id)).id).toBe(third.id);
    await expectApiError(api.deployments.get("dep_missing"), "not_found");
  });
});

describe("deployments.cancel", () => {
  it("cancels a queued deployment now; the never-deployed service is crashed", async () => {
    const [initial] = await api.deployments.list({ serviceId: web.id });
    const cancelled = await api.deployments.cancel(initial.id);
    expect(cancelled).toMatchObject({ status: "cancelled", error: CANCELLED_ERROR });
    expect((await api.services.get(web.id)).status).toBe("crashed");
    await expectApiError(api.deployments.cancel(initial.id), "conflict");
    const [event] = await api.activity.list({ limit: 1 });
    expect(event).toMatchObject({ type: "deployment.cancelled", deploymentId: initial.id });
  });

  it("only flags a running deployment", async () => {
    const [initial] = await api.deployments.list({ serviceId: web.id });
    await markRunning(initial.id, "deploying");
    const result = await api.deployments.cancel(initial.id);
    expect(result.status).toBe("deploying");
    expect((await db().deployment.findUniqueOrThrow({ where: { id: initial.id } })).cancelRequested).toBe(true);
  });
});

describe("deployments.rollback", () => {
  it("redeploys the image of a removed deployment, refuses any other status", async () => {
    const [initial] = await api.deployments.list({ serviceId: web.id });
    await expectApiError(api.deployments.rollback(initial.id), "conflict");
    await db().deployment.update({ where: { id: initial.id }, data: { status: "removed", image: "nginx:1.26" } });

    const rollback = await api.deployments.rollback(initial.id);
    expect(rollback).toMatchObject({ status: "queued", trigger: "rollback", image: "nginx:1.26" });
    expect(rollback.id).not.toBe(initial.id);
    await expectApiError(api.deployments.rollback("dep_missing"), "not_found");
  });
});

describe("deployments.getLogs", () => {
  it("returns the appended lines oldest first", async () => {
    const [deployment] = await api.deployments.list({ serviceId: web.id });
    expect(await api.deployments.getLogs(deployment.id)).toEqual([]);

    const ts = new Date("2026-10-01T10:00:00.000Z");
    expect(
      await appendLogs(deployment.id, [
        { level: "info", stream: "build", message: "Téléchargement de l’image", ts },
        { level: "warn", stream: "build", message: "Couche en cache" },
      ]),
    ).toBe(2);
    expect(await appendLogs(deployment.id, [{ level: "success", stream: "deploy", message: "En ligne" }])).toBe(3);

    const lines = await api.deployments.getLogs(deployment.id);
    expect(lines.map((line) => [line.id, line.level, line.stream, line.message])).toEqual([
      [`${deployment.id}:1`, "info", "build", "Téléchargement de l’image"],
      [`${deployment.id}:2`, "warn", "build", "Couche en cache"],
      [`${deployment.id}:3`, "success", "deploy", "En ligne"],
    ]);
    expect(lines[0].ts).toBe(ts.toISOString());
  });

  it("truncates very long lines and ignores a deployment that is gone", async () => {
    const [deployment] = await api.deployments.list({ serviceId: web.id });
    await appendLogs(deployment.id, [{ level: "error", stream: "build", message: "x".repeat(9000) }]);
    const [line] = await api.deployments.getLogs(deployment.id);
    expect(line.message).toHaveLength(8001);
    expect(line.message.endsWith("…")).toBe(true);

    expect(await appendLogs("dep_missing", [{ level: "info", stream: "build", message: "perdu" }])).toBe(0);
    expect(await appendLogs(deployment.id, [])).toBe(0);
    await expectApiError(api.deployments.getLogs("dep_missing"), "not_found");
  });

  it("logs of every deployment of a service go with it", async () => {
    const [deployment] = await api.deployments.list({ serviceId: web.id });
    await appendLogs(deployment.id, [{ level: "info", stream: "build", message: "ligne" }]);
    await api.services.delete(web.id);
    expect(await db().deploymentLog.count()).toBe(0);
  });
});
