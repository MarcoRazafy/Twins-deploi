import { beforeEach, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { Service } from "@/lib/types";
import { db } from "@/server/db";
import { resetDatabase } from "../helpers/db";
import { apiAs, deployImage, expectApiError, setupOwner } from "../helpers/api";

let api: Api;
let projectId: string;
let web: Service;

beforeEach(async () => {
  await resetDatabase();
  api = apiAs(await setupOwner());
  projectId = (await api.projects.create({ name: "Variables" })).id;
  web = await deployImage(api, projectId, "web");
});

describe("variables.create / update / delete", () => {
  it("creates shared and service variables, encrypted at rest", async () => {
    const shared = await api.variables.create({ projectId, serviceId: null, key: "LOG_LEVEL", value: "debug" });
    const own = await api.variables.create({ projectId, serviceId: web.id, key: "LOG_LEVEL", value: "info" });
    expect(shared).toMatchObject({ serviceId: null, key: "LOG_LEVEL", value: "debug", isSecret: false });
    expect(own).toMatchObject({ serviceId: web.id, key: "LOG_LEVEL", value: "info" });

    const row = await db().envVariable.findUniqueOrThrow({ where: { id: shared.id } });
    expect(row.valueEncrypted).not.toContain("debug");

    expect((await api.variables.list({ projectId, serviceId: null })).map((v) => v.id)).toEqual([shared.id]);
    expect((await api.variables.list({ serviceId: web.id })).map((v) => v.id)).toEqual([own.id]);
    expect(await api.variables.list({ projectId })).toHaveLength(2);
  });

  it("isSecret is inferred from the key unless given, and the value is returned to an authorised caller", async () => {
    const token = await api.variables.create({ projectId, serviceId: web.id, key: "API_TOKEN", value: "s3cr3t" });
    const url = await api.variables.create({ projectId, serviceId: web.id, key: "DATABASE_URL", value: "postgres://x" });
    const plain = await api.variables.create({ projectId, serviceId: web.id, key: "MODE", value: "prod" });
    const forced = await api.variables.create({ projectId, serviceId: web.id, key: "PASSWORD_HINT", value: "chat", isSecret: false });
    expect([token.isSecret, url.isSecret, plain.isSecret, forced.isSecret]).toEqual([true, true, false, false]);
    // Masking is the interface's job: developers (the only readers) get the value.
    expect(token.value).toBe("s3cr3t");

    const toggled = await api.variables.update(plain.id, { isSecret: true });
    expect(toggled).toMatchObject({ isSecret: true, value: "prod" });
  });

  it("validates keys: pattern, reserved TWINS_ prefix, and uniqueness within a scope", async () => {
    await expectApiError(api.variables.create({ projectId, serviceId: null, key: "1ABC", value: "" }), "validation", "key");
    await expectApiError(api.variables.create({ projectId, serviceId: null, key: "MY-KEY", value: "" }), "validation", "key");
    await expectApiError(api.variables.create({ projectId, serviceId: null, key: "", value: "" }), "validation", "key");
    const reserved = await expectApiError(
      api.variables.create({ projectId, serviceId: web.id, key: "TWINS_PUBLIC_DOMAIN", value: "x" }),
      "validation",
      "key",
    );
    expect(reserved.message).toContain("TWINS_");
    await expectApiError(api.variables.create({ projectId, serviceId: undefined as never, key: "A", value: "" }), "validation", "serviceId");
    await expectApiError(api.variables.create({ projectId, serviceId: null, key: "A", value: 42 as never }), "validation", "value");

    await api.variables.create({ projectId, serviceId: null, key: "DUP", value: "1" });
    await expectApiError(api.variables.create({ projectId, serviceId: null, key: "DUP", value: "2" }), "conflict", "key");
    await api.variables.create({ projectId, serviceId: web.id, key: "DUP", value: "service override" });
    await expectApiError(api.variables.create({ projectId, serviceId: web.id, key: "DUP", value: "3" }), "conflict", "key");
  });

  it("checks the scope", async () => {
    const other = await api.projects.create({ name: "Autre" });
    await expectApiError(api.variables.create({ projectId: "prj_missing", serviceId: null, key: "A", value: "" }), "not_found");
    await expectApiError(api.variables.create({ projectId, serviceId: "svc_missing", key: "A", value: "" }), "not_found");
    await expectApiError(api.variables.create({ projectId: other.id, serviceId: web.id, key: "A", value: "" }), "validation", "serviceId");
  });

  it("updates key and value, refuses a rename onto a taken key, deletes", async () => {
    const a = await api.variables.create({ projectId, serviceId: web.id, key: "A", value: "1" });
    await api.variables.create({ projectId, serviceId: web.id, key: "B", value: "2" });

    const updated = await api.variables.update(a.id, { key: "A2", value: "11" });
    expect(updated).toMatchObject({ id: a.id, key: "A2", value: "11" });
    await expectApiError(api.variables.update(a.id, { key: "B" }), "conflict", "key");
    await expectApiError(api.variables.update(a.id, { key: "TWINS_A" }), "validation", "key");
    await expectApiError(api.variables.update("var_missing", { value: "x" }), "not_found");

    await api.variables.delete(a.id);
    expect((await api.variables.list({ serviceId: web.id })).map((v) => v.key)).toEqual(["B"]);
    await expectApiError(api.variables.delete(a.id), "not_found");
  });
});

describe("variables.bulkUpsert", () => {
  it("upserts by key, the last occurrence wins, other keys stay unless replace", async () => {
    const kept = await api.variables.create({ projectId, serviceId: web.id, key: "KEEP", value: "k" });
    const changed = await api.variables.create({ projectId, serviceId: web.id, key: "CHANGE", value: "old" });

    const result = await api.variables.bulkUpsert({
      projectId,
      serviceId: web.id,
      entries: [
        { key: "NEW", value: "first" },
        { key: "CHANGE", value: "new" },
        { key: "NEW", value: "second" },
      ],
    });
    const byKey = Object.fromEntries(result.map((v) => [v.key, v]));
    expect(Object.keys(byKey).sort()).toEqual(["CHANGE", "KEEP", "NEW"]);
    expect(byKey.NEW.value).toBe("second");
    // Updated in place: same id.
    expect(byKey.CHANGE).toMatchObject({ id: changed.id, value: "new" });
    expect(byKey.KEEP).toMatchObject({ id: kept.id, value: "k" });

    const replaced = await api.variables.bulkUpsert({
      projectId,
      serviceId: web.id,
      entries: [{ key: "NEW", value: "second" }],
      replace: true,
    });
    expect(replaced.map((v) => v.key)).toEqual(["NEW"]);
  });

  it("only touches its own scope and validates every entry first", async () => {
    await api.variables.create({ projectId, serviceId: null, key: "SHARED", value: "s" });
    await api.variables.bulkUpsert({ projectId, serviceId: web.id, entries: [{ key: "OWN", value: "o" }], replace: true });
    expect((await api.variables.list({ projectId, serviceId: null })).map((v) => v.key)).toEqual(["SHARED"]);

    await expectApiError(
      api.variables.bulkUpsert({ projectId, serviceId: web.id, entries: [{ key: "OK", value: "1" }, { key: "TWINS_NO", value: "2" }] }),
      "validation",
      "key",
    );
    await expectApiError(api.variables.bulkUpsert({ projectId, serviceId: web.id, entries: "A=1" as never }), "validation", "entries");
    expect((await api.variables.list({ serviceId: web.id })).map((v) => v.key)).toEqual(["OWN"]);
  });

  it("records an activity only when something changed", async () => {
    const count = () => db().activityEvent.count({ where: { type: "variable.updated" } });
    await api.variables.bulkUpsert({ projectId, serviceId: null, entries: [{ key: "A", value: "1" }] });
    const after = await count();
    await api.variables.bulkUpsert({ projectId, serviceId: null, entries: [{ key: "A", value: "1" }] });
    expect(await count()).toBe(after);
  });
});

describe("variables.builtins", () => {
  it("lists PORT and the TWINS_* variables of the service", async () => {
    const builtins = await api.variables.builtins(web.id);
    const values = Object.fromEntries(builtins.map((v) => [v.key, v.value]));
    expect(values).toMatchObject({
      PORT: "8080",
      TWINS_PUBLIC_DOMAIN: "",
      TWINS_PRIVATE_DOMAIN: "web.twinsdeploi.internal",
      TWINS_PROJECT_NAME: "Variables",
      TWINS_PROJECT_ID: projectId,
      TWINS_SERVICE_NAME: "web",
      TWINS_SERVICE_ID: web.id,
      TWINS_ENVIRONMENT_NAME: "production",
      TWINS_REGION: "mg-analamanga",
      TWINS_DEPLOYMENT_ID: "",
    });
    expect(values).not.toHaveProperty("TWINS_VOLUME_NAME");
    expect(builtins.every((v) => v.description.length > 0)).toBe(true);
    await expectApiError(api.variables.builtins("svc_missing"), "not_found");
  });

  it("reflects the generated domain, the port and a volume", async () => {
    const domain = await api.domains.generate(web.id);
    await api.services.update(web.id, { config: { port: 9090 }, volume: { mountPath: "/data", sizeGb: 1 } });
    const values = Object.fromEntries((await api.variables.builtins(web.id)).map((v) => [v.key, v.value]));
    expect(values.TWINS_PUBLIC_DOMAIN).toBe(domain.hostname);
    expect(values.PORT).toBe("9090");
    expect(values.TWINS_VOLUME_MOUNT_PATH).toBe("/data");
    expect(values.TWINS_VOLUME_NAME).toMatch(/\S/);
  });
});
