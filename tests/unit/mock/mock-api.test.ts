import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ApiError, type Api } from "@/lib/api/contract";
import { createMockApi } from "@/lib/mock";
import { resetDb } from "@/lib/mock/db";
import { setLatency } from "@/lib/mock/latency";

let api: Api;
beforeAll(() => {
  setLatency(0);
  api = createMockApi();
});
beforeEach(() => {
  resetDb();
});

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("La promesse devait être rejetée");
}

async function newService(name = "Web") {
  const project = await api.projects.create({ name: "Projet test" });
  const service = await api.docker.deployImage({ projectId: project.id, image: "nginx", name, port: 8080 });
  return { project, service };
}

describe("projets", () => {
  it("crée, liste et récupère un projet", async () => {
    const created = await api.projects.create({ name: "  Mon Projet Été  ", description: " desc " });
    expect(created).toMatchObject({ name: "Mon Projet Été", slug: "mon-projet-ete", description: "desc", environment: "production" });
    const list = await api.projects.list();
    expect(list.some((p) => p.id === created.id)).toBe(true);
    expect(await api.projects.get(created.id)).toMatchObject({ id: created.id, name: "Mon Projet Été" });
  });
  it("refuse nom trop court et doublon (casse ignorée)", async () => {
    expect(await rejection(api.projects.create({ name: "a" }))).toMatchObject({ code: "validation", field: "name" });
    await api.projects.create({ name: "Alpha" });
    expect(await rejection(api.projects.create({ name: "ALPHA" }))).toMatchObject({ code: "conflict", field: "name" });
  });
  it("suffixe le slug en cas de collision", async () => {
    const a = await api.projects.create({ name: "Mon App" });
    const b = await api.projects.create({ name: "Mon-App" });
    expect(a.slug).toBe("mon-app");
    expect(b.slug).toBe("mon-app-2");
  });
  it("projet inconnu -> not_found", async () => {
    expect(await rejection(api.projects.get("prj_nope"))).toMatchObject({ code: "not_found" });
  });
  it("la suppression d'un projet cascade aux services, variables et domaines", async () => {
    const { project, service } = await newService();
    await api.variables.create({ projectId: project.id, serviceId: service.id, key: "A", value: "1" });
    await api.domains.generate(service.id);
    await api.projects.delete(project.id);
    expect(await rejection(api.projects.get(project.id))).toMatchObject({ code: "not_found" });
    expect(await api.services.list({ projectId: project.id })).toEqual([]);
    expect(await api.variables.list({ projectId: project.id })).toEqual([]);
    expect(await api.domains.list({ projectId: project.id })).toEqual([]);
  });
});

describe("variables", () => {
  it("create / update / delete", async () => {
    const { project, service } = await newService();
    const scope = { projectId: project.id, serviceId: service.id };
    const created = await api.variables.create({ ...scope, key: " API_KEY ", value: "v1", isSecret: true });
    expect(created).toMatchObject({ key: "API_KEY", value: "v1", isSecret: true });
    expect(await rejection(api.variables.create({ ...scope, key: "API_KEY", value: "x" }))).toMatchObject({ code: "conflict" });

    const updated = await api.variables.update(created.id, { value: "v2", key: "API_TOKEN" });
    expect(updated).toMatchObject({ key: "API_TOKEN", value: "v2" });
    expect((await api.variables.list(scope)).map((v) => v.key)).toContain("API_TOKEN");

    await api.variables.delete(created.id);
    expect((await api.variables.list(scope)).some((v) => v.id === created.id)).toBe(false);
    expect(await rejection(api.variables.delete(created.id))).toMatchObject({ code: "not_found" });
  });
  it("refuse clés invalides et préfixe TWINS_ réservé", async () => {
    const { project, service } = await newService();
    const scope = { projectId: project.id, serviceId: service.id };
    expect(await rejection(api.variables.create({ ...scope, key: "TWINS_X", value: "" }))).toMatchObject({ code: "validation", field: "key" });
    expect(await rejection(api.variables.create({ ...scope, key: "1A", value: "" }))).toMatchObject({ code: "validation", field: "key" });
    expect(await rejection(api.variables.create({ ...scope, key: "", value: "" }))).toMatchObject({ code: "validation", field: "key" });
    const ok = await api.variables.create({ ...scope, key: "OK", value: "" });
    expect(await rejection(api.variables.update(ok.id, { key: "TWINS_REGION" }))).toMatchObject({ code: "validation", field: "key" });
    expect(await rejection(api.variables.bulkUpsert({ ...scope, entries: [{ key: "TWINS_A", value: "1" }] }))).toMatchObject({ code: "validation" });
  });
  it("variables partagées (serviceId null)", async () => {
    const { project } = await newService();
    await api.variables.create({ projectId: project.id, serviceId: null, key: "SHARED", value: "s" });
    const shared = await api.variables.list({ projectId: project.id, serviceId: null });
    expect(shared.map((v) => v.key)).toEqual(["SHARED"]);
  });
  it("bulkUpsert : ajoute, modifie, dernier doublon gagnant, replace supprime le reste", async () => {
    const { project, service } = await newService();
    const scope = { projectId: project.id, serviceId: service.id };
    await api.variables.create({ ...scope, key: "KEEP", value: "1" });
    await api.variables.create({ ...scope, key: "DROP", value: "1" });
    const merged = await api.variables.bulkUpsert({
      ...scope,
      entries: [{ key: "KEEP", value: "2" }, { key: "NEW", value: "a" }, { key: "NEW", value: "b" }],
    });
    expect(Object.fromEntries(merged.map((v) => [v.key, v.value]))).toMatchObject({ KEEP: "2", NEW: "b", DROP: "1" });
    const replaced = await api.variables.bulkUpsert({ ...scope, entries: [{ key: "KEEP", value: "2" }], replace: true });
    expect(replaced.map((v) => v.key)).toEqual(["KEEP"]);
  });
  it("builtins(serviceId) renvoie PORT et TWINS_*", async () => {
    const { project, service } = await newService("Web");
    const builtins = await api.variables.builtins(service.id);
    const map = Object.fromEntries(builtins.map((v) => [v.key, v.value]));
    expect(map).toMatchObject({
      PORT: "8080",
      TWINS_PRIVATE_DOMAIN: "web.twinsdeploi.internal",
      TWINS_PROJECT_NAME: "Projet test",
      TWINS_PROJECT_ID: project.id,
      TWINS_SERVICE_NAME: "Web",
      TWINS_SERVICE_ID: service.id,
      TWINS_PUBLIC_DOMAIN: "",
      TWINS_DEPLOYMENT_ID: "",
    });
    expect(Object.keys(map)).toEqual(expect.arrayContaining(["TWINS_ENVIRONMENT_NAME", "TWINS_REGION"]));
    expect(await rejection(api.variables.builtins("svc_nope"))).toMatchObject({ code: "not_found" });
  });
  it("builtins reflète le domaine public après generate", async () => {
    const { service } = await newService();
    const domain = await api.domains.generate(service.id);
    const map = Object.fromEntries((await api.variables.builtins(service.id)).map((v) => [v.key, v.value]));
    expect(map.TWINS_PUBLIC_DOMAIN).toBe(domain.hostname);
  });
});

describe("domaines", () => {
  it("generate : actif, <service>-production-xxxx.<base>", async () => {
    const { service } = await newService("Web");
    const domain = await api.domains.generate(service.id);
    expect(domain).toMatchObject({ kind: "generated", status: "active", serviceId: service.id });
    expect(domain.hostname).toMatch(/^web-production-[0-9a-f]{4}\./);
    expect((await api.domains.list({ serviceId: service.id })).map((d) => d.id)).toEqual([domain.id]);
  });
  it("create : domaine custom en attente DNS, normalisé, avec enregistrements", async () => {
    const { service } = await newService();
    const domain = await api.domains.create({ serviceId: service.id, hostname: " App.Exemple.MG. " });
    expect(domain).toMatchObject({ hostname: "app.exemple.mg", kind: "custom", status: "pending_dns", targetPort: 8080 });
    expect(domain.dnsRecords.length).toBeGreaterThan(0);
  });
  it("create refuse hostname invalide, doublon et port invalide", async () => {
    const { service } = await newService();
    expect(await rejection(api.domains.create({ serviceId: service.id, hostname: "localhost" }))).toMatchObject({ code: "validation", field: "hostname" });
    await api.domains.create({ serviceId: service.id, hostname: "a.exemple.mg" });
    expect(await rejection(api.domains.create({ serviceId: service.id, hostname: "a.exemple.mg" }))).toMatchObject({ code: "conflict", field: "hostname" });
    expect(await rejection(api.domains.create({ serviceId: service.id, hostname: "b.exemple.mg", targetPort: 70_000 }))).toMatchObject({ code: "validation", field: "targetPort" });
  });
  it("delete retire le domaine ; inconnu -> not_found", async () => {
    const { service } = await newService();
    const domain = await api.domains.generate(service.id);
    await api.domains.delete(domain.id);
    expect(await api.domains.list({ serviceId: service.id })).toEqual([]);
    expect(await rejection(api.domains.delete(domain.id))).toMatchObject({ code: "not_found" });
  });
});
