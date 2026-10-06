/**
 * resolveEnvironment (src/server/variables/store.ts): the environment a
 * deployment receives. Rows are created through the API; only resolution is
 * called directly (the worker's entry point).
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { Service } from "@/lib/types";
import { db } from "@/server/db";
import { buildContainerEnvironment } from "@/server/deploy/env-file";
import { resolveEnvironment } from "@/server/variables/store";
import { resetDatabase } from "../helpers/db";
import { apiAs, deployImage, expectApiError, setupOwner } from "../helpers/api";

let api: Api;
let projectId: string;
let web: Service;
let worker: Service;

function shared(key: string, value: string) {
  return api.variables.create({ projectId, serviceId: null, key, value });
}

function own(service: Service, key: string, value: string) {
  return api.variables.create({ projectId, serviceId: service.id, key, value });
}

beforeEach(async () => {
  await resetDatabase();
  api = apiAs(await setupOwner());
  projectId = (await api.projects.create({ name: "Résolution" })).id;
  web = await deployImage(api, projectId, "Web App", { port: 8080 });
  worker = await deployImage(api, projectId, "worker", { port: 9000 });
});

describe("resolveEnvironment", () => {
  it("merges shared variables with the service's own, which win", async () => {
    await shared("LOG_LEVEL", "info");
    await shared("REGION", "tana");
    await own(web, "LOG_LEVEL", "debug");
    const { variables, warnings } = await resolveEnvironment(web.id);
    expect(variables).toEqual({ LOG_LEVEL: "debug", REGION: "tana" });
    expect(warnings).toEqual([]);
    // Another service's own variables are not inherited.
    expect((await resolveEnvironment(worker.id)).variables).toEqual({ LOG_LEVEL: "info", REGION: "tana" });
  });

  it("resolves ${{shared.KEY}} and ${{Service.KEY}} (service name case-insensitive), recursively", async () => {
    await shared("DOMAIN", "exemple.mg");
    await shared("BASE_URL", "https://${{shared.DOMAIN}}");
    await own(web, "SECRET", "abc");
    await own(worker, "CALLBACK", "${{ shared.BASE_URL }}/hook");
    await own(worker, "WEB_SECRET", "${{web app.SECRET}}");
    const { variables, warnings } = await resolveEnvironment(worker.id);
    expect(variables.CALLBACK).toBe("https://exemple.mg/hook");
    expect(variables.WEB_SECRET).toBe("abc");
    expect(warnings).toEqual([]);
  });

  it("exposes the platform variables of a service through references", async () => {
    const domain = await api.domains.generate(web.id);
    await own(worker, "WEB_HOST", "${{Web App.TWINS_PRIVATE_DOMAIN}}:${{Web App.PORT}}");
    await own(worker, "WEB_PUBLIC", "https://${{Web App.TWINS_PUBLIC_DOMAIN}}");
    await own(worker, "ME", "${{worker.TWINS_SERVICE_ID}}");
    const { variables } = await resolveEnvironment(worker.id);
    expect(variables.WEB_HOST).toBe("web-app.twinsdeploi.internal:8080");
    expect(variables.WEB_PUBLIC).toBe(`https://${domain.hostname}`);
    expect(variables.ME).toBe(worker.id);
  });

  it("references see the platform value over a variable of the same name, like the container", async () => {
    // github.importRepo stores PORT as a variable; the port then changes.
    await own(web, "PORT", "8080");
    await api.services.update(web.id, { config: { port: 9090 } });
    await own(worker, "WEB_PORT", "${{Web App.PORT}}");
    expect((await resolveEnvironment(worker.id)).variables.WEB_PORT).toBe("9090");

    const row = await db().service.findUniqueOrThrow({ where: { id: web.id } });
    const container = await buildContainerEnvironment(row, null, "dep_test");
    expect(container.variables.PORT).toBe("9090");
    expect(container.variables.TWINS_DEPLOYMENT_ID).toBe("dep_test");
    expect(container.warnings).toEqual([
      "La variable PORT est fournie par la plateforme : la valeur définie dans le service est ignorée.",
    ]);
  });

  it("an unknown reference becomes empty with a warning that never shows values", async () => {
    await own(web, "SECRET", "hunter2");
    await own(worker, "A", "x${{Nope.KEY}}y");
    await own(worker, "B", "${{Web App.MISSING}}");
    await own(worker, "C", "${{shared.ABSENT}}");
    const { variables, warnings } = await resolveEnvironment(worker.id);
    expect(variables).toMatchObject({ A: "xy", B: "", C: "" });
    expect(warnings).toEqual(
      expect.arrayContaining([
        "Référence inconnue : ${{Nope.KEY}} (remplacée par une valeur vide).",
        "Référence inconnue : ${{Web App.MISSING}} (remplacée par une valeur vide).",
        "Référence inconnue : ${{shared.ABSENT}} (remplacée par une valeur vide).",
      ]),
    );
    expect(warnings.join(" ")).not.toContain("hunter2");
  });

  it("a circular reference becomes empty with a warning", async () => {
    await shared("A", "a-${{shared.B}}");
    await shared("B", "b-${{shared.A}}");
    await own(web, "SELF", "${{Web App.SELF}}!");
    const { variables, warnings } = await resolveEnvironment(web.id);
    expect(variables.A).toBe("a-b-");
    expect(variables.B).toBe("b-a-");
    expect(variables.SELF).toBe("!");
    expect(warnings.some((warning) => warning.startsWith("Référence circulaire ou trop imbriquée"))).toBe(true);
  });

  it("rejects an unknown service", async () => {
    await expectApiError(resolveEnvironment("svc_missing"), "not_found");
  });
});

describe("PostgreSQL connection variables", () => {
  it("databases.create needs no Docker, connects a consumer and DATABASE_URL resolves", async () => {
    const database = await api.databases.create({ projectId, connectToServiceId: web.id });
    expect(database).toMatchObject({ name: "Postgres", status: "building", host: "postgres.railway.internal", port: 5432, username: "postgres", database: "railway" });
    const [deployment] = await api.deployments.list({ serviceId: database.serviceId });
    expect(deployment.status).toBe("queued");

    // The database service carries its connection variables.
    const dbVariables = await api.variables.list({ serviceId: database.serviceId });
    expect(dbVariables.map((v) => v.key).sort()).toEqual(["DATABASE_URL", "PGDATABASE", "PGHOST", "PGPASSWORD", "PGPORT", "PGUSER"]);
    expect(dbVariables.every((v) => v.isSecret === /URL|PASSWORD/.test(v.key))).toBe(true);

    // The consumer got a reference, not a copy.
    const [reference] = await api.variables.list({ serviceId: web.id });
    expect(reference).toMatchObject({ key: "DATABASE_URL", value: "${{Postgres.DATABASE_URL}}", isSecret: true });
    expect((await resolveEnvironment(web.id)).variables.DATABASE_URL).toBe(database.internalUrl);
    expect(database.internalUrl).toBe(
      `postgresql://postgres:${encodeURIComponent(database.password)}@postgres.railway.internal:5432/railway`,
    );
    expect(await api.services.listConnections(projectId)).toEqual([
      expect.objectContaining({ fromServiceId: web.id, toServiceId: database.serviceId }),
    ]);
  });

  it("falls back to the database record when the connection variable was deleted", async () => {
    const database = await api.databases.create({ projectId, name: "Main DB" });
    const pgUser = (await api.variables.list({ serviceId: database.serviceId })).find((v) => v.key === "PGUSER");
    if (!pgUser) throw new Error("PGUSER missing");
    await api.variables.delete(pgUser.id);
    await own(worker, "USER", "${{main db.PGUSER}}");
    await own(worker, "PASS", "${{Main DB.PGPASSWORD}}");
    const { variables, warnings } = await resolveEnvironment(worker.id);
    expect(variables).toMatchObject({ USER: "postgres", PASS: database.password });
    expect(warnings).toEqual([]);
  });

  it("services.connect adds DATABASE_URL to the consumer unless it defines one", async () => {
    const database = await api.databases.create({ projectId });
    await own(worker, "DATABASE_URL", "postgres://elsewhere");
    await api.services.connect({ fromServiceId: web.id, toServiceId: database.serviceId });
    await api.services.connect({ fromServiceId: worker.id, toServiceId: database.serviceId });
    expect((await api.variables.list({ serviceId: web.id }))[0].value).toBe("${{Postgres.DATABASE_URL}}");
    expect((await api.variables.list({ serviceId: worker.id }))[0].value).toBe("postgres://elsewhere");
    await expectApiError(api.services.connect({ fromServiceId: web.id, toServiceId: database.serviceId }), "conflict");
    await expectApiError(api.services.connect({ fromServiceId: web.id, toServiceId: web.id }), "validation");
  });
});
