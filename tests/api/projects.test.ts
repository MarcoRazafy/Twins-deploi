import { beforeEach, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import { PROJECT_COLORS } from "@/lib/types";
import { db } from "@/server/db";
import { appendLogs } from "@/server/deployments/logs";
import { resetDatabase } from "../helpers/db";
import { apiAs, deployImage, expectApiError, setupOwner } from "../helpers/api";

let api: Api;

beforeEach(async () => {
  await resetDatabase();
  api = apiAs(await setupOwner());
});

describe("projects.create", () => {
  it("creates a project with its defaults", async () => {
    const project = await api.projects.create({ name: "  Boutique en ligne  ", description: " Vitrine " });
    expect(project).toMatchObject({
      name: "Boutique en ligne",
      slug: "boutique-en-ligne",
      description: "Vitrine",
      environment: "production",
      region: "mg-analamanga",
      color: PROJECT_COLORS[0],
    });
    expect(project.id).toMatch(/^prj_/);
    // The palette rotates.
    expect((await api.projects.create({ name: "Second" })).color).toBe(PROJECT_COLORS[1]);
  });

  it("validates the name, the description, the color and the region", async () => {
    await expectApiError(api.projects.create({ name: "x" }), "validation", "name");
    await expectApiError(api.projects.create({ name: "x".repeat(41) }), "validation", "name");
    await expectApiError(api.projects.create({ name: "Valide", description: "d".repeat(281) }), "validation", "description");
    await expectApiError(api.projects.create({ name: "Valide", color: "black" as never }), "validation", "color");
    await expectApiError(api.projects.create({ name: "Valide", region: "us-east" as never }), "validation", "region");
    expect(await db().project.count()).toBe(0);
  });

  it("refuses a name already taken (case-insensitive) and keeps slugs unique", async () => {
    await api.projects.create({ name: "Mon Projet" });
    await expectApiError(api.projects.create({ name: "mon projet" }), "conflict", "name");
    // Different name, same slug: suffixed.
    const other = await api.projects.create({ name: "mon-projet" });
    expect(other.slug).toBe("mon-projet-2");
  });
});

describe("projects.list / get", () => {
  it("lists newest first with summaries", async () => {
    const first = await api.projects.create({ name: "Alpha" });
    const second = await api.projects.create({ name: "Beta" });
    await deployImage(api, second.id, "web");
    await api.variables.create({ projectId: second.id, serviceId: null, key: "SHARED", value: "1" });

    const list = await api.projects.list();
    expect(list.map((project) => project.id)).toEqual([second.id, first.id]);
    const [beta, alpha] = list;
    expect(alpha.stats).toMatchObject({ services: 0, variables: 0, deployments: 0 });
    expect(alpha.lastDeployment).toBeNull();
    expect(beta.stats).toMatchObject({ services: 1, inProgress: 1, variables: 1, deployments: 1, domains: 0 });
    expect(beta.services).toEqual([expect.objectContaining({ name: "web", type: "docker", status: "building" })]);
    expect(beta.lastDeployment?.status).toBe("queued");

    expect(await api.projects.get(second.id)).toEqual(beta);
    await expectApiError(api.projects.get("prj_missing"), "not_found");
  });
});

describe("projects.update", () => {
  it("renames (new slug), changes the description and checks conflicts", async () => {
    const project = await api.projects.create({ name: "Ancien nom" });
    await api.projects.create({ name: "Pris" });

    const renamed = await api.projects.update(project.id, { name: "Nouveau nom", description: "Texte", color: "green" });
    expect(renamed).toMatchObject({ name: "Nouveau nom", slug: "nouveau-nom", description: "Texte", color: "green" });

    // Same name with another case: allowed, the slug stays.
    const recased = await api.projects.update(project.id, { name: "NOUVEAU NOM" });
    expect(recased).toMatchObject({ name: "NOUVEAU NOM", slug: "nouveau-nom" });

    await expectApiError(api.projects.update(project.id, { name: "pris" }), "conflict", "name");
    await expectApiError(api.projects.update(project.id, { name: "" }), "validation", "name");
    await expectApiError(api.projects.update("prj_missing", { description: "x" }), "not_found");
  });
});

describe("projects.delete", () => {
  it("cascades to services, deployments, logs, variables, domains, connections and databases", async () => {
    const project = await api.projects.create({ name: "Condamné" });
    const keep = await api.projects.create({ name: "Survivant" });
    const web = await deployImage(api, project.id, "web");
    const worker = await deployImage(api, project.id, "worker");
    await deployImage(api, keep.id, "web");
    await api.variables.create({ projectId: project.id, serviceId: null, key: "SHARED", value: "1" });
    await api.variables.create({ projectId: project.id, serviceId: web.id, key: "OWN", value: "1" });
    await api.domains.generate(web.id);
    await api.domains.create({ serviceId: web.id, hostname: "app.exemple.mg" });
    await api.services.connect({ fromServiceId: worker.id, toServiceId: web.id });
    await api.databases.create({ projectId: project.id });
    const [deployment] = await api.deployments.list({ serviceId: web.id });
    await appendLogs(deployment.id, [{ level: "info", stream: "build", message: "ligne" }]);

    await api.projects.delete(project.id);

    const where = { projectId: project.id };
    expect(await db().project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await db().service.count({ where })).toBe(0);
    expect(await db().deployment.count({ where })).toBe(0);
    expect(await db().deploymentLog.count({ where: { deploymentId: deployment.id } })).toBe(0);
    expect(await db().envVariable.count({ where })).toBe(0);
    expect(await db().domain.count({ where })).toBe(0);
    expect(await db().serviceConnection.count({ where })).toBe(0);
    expect(await db().managedDatabase.count({ where })).toBe(0);
    // The other project is untouched.
    expect(await db().service.count({ where: { projectId: keep.id } })).toBe(1);

    // The worker gets what it needs to remove containers, volumes and the network.
    const jobs = await db().job.findMany({ select: { type: true } });
    expect(jobs.filter((job) => job.type === "cleanup.service")).toHaveLength(3);
    expect(jobs.filter((job) => job.type === "cleanup.project")).toHaveLength(1);

    // The audit trail survives without dangling links.
    expect(await db().activityEvent.count({ where })).toBe(0);
    const [latest] = await api.activity.list({ limit: 1 });
    expect(latest).toMatchObject({ type: "project.deleted", description: "Condamné", projectId: null });

    await expectApiError(api.projects.delete(project.id), "not_found");
  });
});
