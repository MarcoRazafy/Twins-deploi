import { beforeEach, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { UserProfile } from "@/lib/types";
import { recordActivity, SYSTEM_ACTOR } from "@/server/activity";
import { db } from "@/server/db";
import { resetDatabase } from "../helpers/db";
import { apiAs, deployImage, setupOwner } from "../helpers/api";

let owner: UserProfile;
let api: Api;

beforeEach(async () => {
  await resetDatabase();
  owner = await setupOwner();
  api = apiAs(owner);
});

describe("recorded actions", () => {
  it("project, service, deployment, variable and domain actions land in the journal", async () => {
    const project = await api.projects.create({ name: "Journal" });
    const service = await deployImage(api, project.id, "web");
    await api.variables.create({ projectId: project.id, serviceId: service.id, key: "A", value: "1" });
    await api.domains.generate(service.id);
    await api.projects.update(project.id, { description: "modifié" });

    const events = await api.activity.list({ projectId: project.id });
    expect(events.map((event) => event.type).reverse()).toEqual([
      "project.created",
      "service.created",
      "deployment.started",
      "variable.updated",
      "domain.added",
      "project.updated",
    ]);
    expect(events.every((event) => event.actor === owner.name && event.read)).toBe(true);
    const started = events.find((event) => event.type === "deployment.started");
    expect(started).toMatchObject({ serviceId: service.id, description: "web · nginx:1.27" });
    expect(started?.deploymentId).toMatch(/^dep_/);
  });
});

describe("activity.list / markRead", () => {
  it("filters by project, unread and limit; markRead marks some or all", async () => {
    const project = await api.projects.create({ name: "Notifications" });
    const a = await recordActivity({ type: "deployment.failed", severity: "error", title: "Échec", description: "a", projectId: project.id, notify: true });
    const b = await recordActivity({ type: "service.crashed", severity: "error", title: "Arrêt", description: "b", notify: true });
    expect([a.read, b.read, a.actor]).toEqual([false, false, SYSTEM_ACTOR]);

    expect((await api.activity.list({ unreadOnly: true })).map((event) => event.id)).toEqual([b.id, a.id]);
    expect((await api.activity.list({ projectId: project.id })).map((event) => event.id)).toContain(a.id);
    expect((await api.activity.list({ projectId: project.id })).map((event) => event.id)).not.toContain(b.id);
    expect(await api.activity.list({ limit: 1 })).toHaveLength(1);
    expect(await api.activity.list({ limit: 0 })).toEqual([]);

    await api.activity.markRead([a.id]);
    expect((await api.activity.list({ unreadOnly: true })).map((event) => event.id)).toEqual([b.id]);
    await api.activity.markRead("all");
    expect(await api.activity.list({ unreadOnly: true })).toEqual([]);
  });

  it("notification preferences decide whether an outcome starts unread", async () => {
    await api.settings.update({ notifications: { deploySucceeded: false } });
    const quiet = await recordActivity({ type: "deployment.succeeded", title: "OK", description: "", notify: true });
    const loud = await recordActivity({ type: "deployment.failed", title: "KO", description: "", notify: true });
    expect([quiet.read, loud.read]).toEqual([true, false]);

    await api.settings.update({ notifications: { inApp: false } });
    expect((await recordActivity({ type: "deployment.failed", title: "KO", description: "", notify: true })).read).toBe(true);
  });

  it("keeps only the 300 most recent events", async () => {
    const old = new Date("2026-01-01T00:00:00Z");
    await db().activityEvent.createMany({
      data: Array.from({ length: 300 }, (_, index) => ({
        id: `act_old${String(index).padStart(5, "0")}`,
        type: "settings.updated",
        severity: "info",
        title: "Ancien",
        actor: SYSTEM_ACTOR,
        createdAt: new Date(old.getTime() + index),
      })),
    });
    const latest = await recordActivity({ type: "settings.updated", title: "Récent", description: "" });
    expect(await db().activityEvent.count()).toBe(300);
    expect((await api.activity.list({ limit: 1 }))[0].id).toBe(latest.id);
    expect(await db().activityEvent.findUnique({ where: { id: "act_old00000" } })).toBeNull();
  });
});
