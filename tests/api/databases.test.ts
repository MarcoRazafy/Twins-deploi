/**
 * Project databases without Docker: creation, settings and backups bookkeeping
 * are rows; everything that talks to the PostgreSQL container answers
 * "unavailable" while the service has no running container.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import { db } from "@/server/db";
import { resetDatabase } from "../helpers/db";
import { apiAs, deployImage, expectApiError, setupOwner } from "../helpers/api";

let api: Api;
let projectId: string;

beforeEach(async () => {
  await resetDatabase();
  api = apiAs(await setupOwner());
  projectId = (await api.projects.create({ name: "Bases" })).id;
});

describe("databases.create", () => {
  it("creates a PostgreSQL service with its volume and a queued deployment", async () => {
    const database = await api.databases.create({ projectId, version: "16", storageGb: 2 });
    expect(database).toMatchObject({
      name: "Postgres",
      engine: "postgres",
      version: "16",
      status: "building",
      storageLimitMb: 2048,
      maxConnections: 100,
      publicNetworking: false,
      publicUrl: null,
      storageUsedMb: 0,
    });
    expect(database.password).toMatch(/^\S{20,}$/);
    const service = await api.services.get(database.serviceId);
    expect(service).toMatchObject({
      source: { type: "postgres", version: "16" },
      config: { port: 5432, restartPolicy: "always" },
      volume: { mountPath: "/var/lib/postgresql/data", sizeGb: 2 },
    });
    const [deployment] = await api.deployments.list({ serviceId: database.serviceId });
    expect(deployment).toMatchObject({ status: "queued", image: "postgres:16-alpine" });

    expect((await api.databases.getByService(database.serviceId)).id).toBe(database.id);
    expect((await api.databases.list({ projectId })).map((item) => item.id)).toEqual([database.id]);
  });

  it("suffixes the default name, refuses a taken explicit one and validates the input", async () => {
    await api.databases.create({ projectId });
    const second = await api.databases.create({ projectId });
    expect(second).toMatchObject({ name: "Postgres-2", host: "postgres-2.railway.internal" });

    await expectApiError(api.databases.create({ projectId, name: "postgres" }), "conflict", "name");
    await expectApiError(api.databases.create({ projectId, version: "14" }), "validation", "version");
    await expectApiError(api.databases.create({ projectId, storageGb: 0 }), "validation", "storageGb");
    await expectApiError(api.databases.create({ projectId, publicNetworking: "on" as never }), "validation", "publicNetworking");
    await expectApiError(api.databases.create({ projectId: "prj_missing" }), "not_found");
    await expectApiError(api.databases.create({ projectId, connectToServiceId: "svc_missing" }), "not_found");

    const elsewhere = await api.projects.create({ name: "Ailleurs" });
    const foreign = await deployImage(api, elsewhere.id, "web");
    await expectApiError(api.databases.create({ projectId, connectToServiceId: foreign.id }), "validation", "connectToServiceId");
    expect(await db().managedDatabase.count()).toBe(2);
  });
});

describe("databases.update", () => {
  it("records the settings and keeps the service volume in step", async () => {
    const database = await api.databases.create({ projectId });
    const updated = await api.databases.update(database.id, { maxConnections: 50, publicNetworking: true, storageLimitMb: 10_240 });
    expect(updated).toMatchObject({ maxConnections: 50, publicNetworking: true, storageLimitMb: 10_240, publicUrl: null });
    expect((await api.services.get(database.serviceId)).volume?.sizeGb).toBe(10);

    await expectApiError(api.databases.update(database.id, { maxConnections: 5 }), "validation", "maxConnections");
    await expectApiError(api.databases.update(database.id, { storageLimitMb: 100 }), "validation", "storageLimitMb");
    await expectApiError(api.databases.update("db_missing", {}), "not_found");
  });

  it("the volume of a database cannot be detached or moved, nor its source changed", async () => {
    const database = await api.databases.create({ projectId });
    await expectApiError(api.services.update(database.serviceId, { volume: null }), "validation", "volume");
    await expectApiError(api.services.update(database.serviceId, { volume: { mountPath: "/data", sizeGb: 5 } }), "validation", "volume.mountPath");
    await expectApiError(api.services.update(database.serviceId, { source: { tag: "x" } }), "validation", "source");
    const renamed = await api.services.update(database.serviceId, { name: "Main" });
    expect(renamed.name).toBe("Main");
    expect((await api.databases.get(database.id)).name).toBe("Main");
  });
});

describe("live operations without a running container", () => {
  it("answer unavailable (SQL is checked before connecting)", async () => {
    const database = await api.databases.create({ projectId });
    await expectApiError(api.databases.listTables(database.id), "unavailable");
    await expectApiError(api.databases.getTableData(database.id, "users"), "unavailable");
    await expectApiError(api.databases.runQuery(database.id, "SELECT 1"), "unavailable");
    await expectApiError(api.databases.runQuery(database.id, "SELECT 1; SELECT 2"), "validation", "sql");
    await expectApiError(api.databases.rotatePassword(database.id), "unavailable");
    await expectApiError(api.databases.createBackup(database.id), "unavailable");
  });
});

describe("backups bookkeeping", () => {
  it("lists, refuses to restore an unfinished one, deletes a finished one", async () => {
    const database = await api.databases.create({ projectId });
    const insert = (id: string, status: string) =>
      db().databaseBackup.create({ data: { id, databaseId: database.id, label: id, type: "manual", status } });
    await insert("bkp_running", "in_progress");
    await insert("bkp_done", "completed");

    expect((await api.databases.listBackups(database.id)).map((backup) => backup.id).sort()).toEqual(["bkp_done", "bkp_running"]);
    await expectApiError(api.databases.restoreBackup(database.id, "bkp_running"), "validation");
    // Completed, but the service is still building.
    await expectApiError(api.databases.restoreBackup(database.id, "bkp_done"), "conflict");
    await expectApiError(api.databases.restoreBackup(database.id, "bkp_missing"), "not_found");

    await expectApiError(api.databases.deleteBackup(database.id, "bkp_running"), "conflict");
    await api.databases.deleteBackup(database.id, "bkp_done");
    expect((await api.databases.listBackups(database.id)).map((backup) => backup.id)).toEqual(["bkp_running"]);
  });
});

describe("databases.startCommand", () => {
  it("targets an application service of the project: the linked one by default", async () => {
    const database = await api.databases.create({ projectId });
    // Checked first, whatever the target.
    await expectApiError(api.databases.startCommand(database.id, "   "), "validation", "command");
    await expectApiError(api.databases.startCommand(database.id, "x".repeat(4001)), "validation", "command");
    await expectApiError(api.databases.startCommand("db_missing", "ls"), "not_found");

    // No application linked to the database yet.
    await expectApiError(api.databases.startCommand(database.id, "npm run"), "validation", "serviceId");

    const web = await deployImage(api, projectId, "web");
    // Named explicitly: accepted, but its container is not running in these tests.
    await expectApiError(api.databases.startCommand(database.id, "npm run", web.id), "unavailable");
    // Still not linked: no default target.
    await expectApiError(api.databases.startCommand(database.id, "npm run"), "validation", "serviceId");
    await api.services.connect({ fromServiceId: database.serviceId, toServiceId: web.id });
    await expectApiError(api.databases.startCommand(database.id, "npm run"), "unavailable");

    // Never a database, never another project.
    await expectApiError(api.databases.startCommand(database.id, "ls", database.serviceId), "validation", "serviceId");
    const elsewhere = await api.projects.create({ name: "Ailleurs" });
    const foreign = await deployImage(api, elsewhere.id, "web");
    await expectApiError(api.databases.startCommand(database.id, "ls", foreign.id), "not_found");

    // Nothing was started.
    await expectApiError(api.databases.getCommand(database.id, "cmd_missing"), "not_found");
    await expectApiError(api.databases.getCommand("db_missing", "cmd_missing"), "not_found");
  });
});
