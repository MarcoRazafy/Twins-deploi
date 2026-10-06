/**
 * Domains. The privileged helpers are disabled in tests (setup-env.ts): a
 * domain whose service has no container stays "verifying", nothing is published.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { Service } from "@/lib/types";
import { db } from "@/server/db";
import { publishDomain, syncPrimaryDomain } from "@/server/domains/publish";
import { PROXY_NOT_CONFIGURED } from "@/server/proxy";
import { resetDatabase } from "../helpers/db";
import { apiAs, deployImage, expectApiError, setupOwner } from "../helpers/api";

let api: Api;
let projectId: string;
let web: Service;

beforeEach(async () => {
  await resetDatabase();
  api = apiAs(await setupOwner());
  projectId = (await api.projects.create({ name: "Ma Boutique" })).id;
  web = await deployImage(api, projectId, "Web", { port: 8080 });
});

describe("domains.generate", () => {
  it("creates <service>-<project>-xxxx.<base domain>, waiting for a container", async () => {
    const domain = await api.domains.generate(web.id);
    expect(domain.hostname).toMatch(/^web-ma-boutique-[0-9a-f]{4}\.platform\.test$/);
    expect(domain).toMatchObject({
      kind: "generated",
      status: "verifying",
      targetPort: 8080,
      dnsRecords: [],
      serviceId: web.id,
      projectId,
      error: null,
    });
    const second = await api.domains.generate(web.id);
    expect(second.hostname).not.toBe(domain.hostname);
    // Not active: the service has no primary domain yet.
    expect((await api.services.get(web.id)).primaryDomain).toBeNull();
  });

  it("refuses a database service and an unknown service", async () => {
    const database = await api.databases.create({ projectId });
    await expectApiError(api.domains.generate(database.serviceId), "validation", "serviceId");
    await expectApiError(api.domains.generate("svc_missing"), "not_found");
  });
});

describe("domains.create", () => {
  it("a public custom domain waits for DNS with the records to set", async () => {
    const sub = await api.domains.create({ serviceId: web.id, hostname: "  App.Exemple.MG. " });
    expect(sub).toMatchObject({
      hostname: "app.exemple.mg",
      kind: "custom",
      status: "pending_dns",
      targetPort: 8080,
      dnsRecords: [{ type: "CNAME", name: "app", value: "ingress.platform.test", verified: false }],
    });
    const apex = await api.domains.create({ serviceId: web.id, hostname: "exemple.mg", targetPort: 8081 });
    expect(apex).toMatchObject({ targetPort: 8081, dnsRecords: [{ type: "A", name: "@", value: "127.0.0.1" }] });
    const twoLabelSuffix = await api.domains.create({ serviceId: web.id, hostname: "shop.co.mg" });
    expect(twoLabelSuffix.dnsRecords[0]).toMatchObject({ type: "A", name: "@" });
  });

  it("a local (.test) domain needs no DNS", async () => {
    const local = await api.domains.create({ serviceId: web.id, hostname: "boutique.test" });
    expect(local).toMatchObject({ status: "verifying", dnsRecords: [] });
  });

  it("validates hostnames, reserved names and duplicates", async () => {
    for (const hostname of ["localhost", "no_underscore.mg", "-bad.mg", "a..b.mg", "exemple.m", ""]) {
      await expectApiError(api.domains.create({ serviceId: web.id, hostname }), "validation", "hostname");
    }
    await expectApiError(api.domains.create({ serviceId: web.id, hostname: "platform.test" }), "conflict", "hostname");
    await expectApiError(api.domains.create({ serviceId: web.id, hostname: "x.platform.test" }), "validation", "hostname");
    await expectApiError(api.domains.create({ serviceId: web.id, hostname: "ok.exemple.mg", targetPort: 0 }), "validation", "targetPort");

    await api.domains.create({ serviceId: web.id, hostname: "app.exemple.mg" });
    const other = await deployImage(api, projectId, "other");
    await expectApiError(api.domains.create({ serviceId: other.id, hostname: "APP.exemple.mg" }), "conflict", "hostname");
    await expectApiError(api.domains.create({ serviceId: "svc_missing", hostname: "z.exemple.mg" }), "not_found");
  });
});

describe("domains.list / update / delete", () => {
  it("filters, updates the port and HTTPS flag, deletes", async () => {
    const generated = await api.domains.generate(web.id);
    const other = await deployImage(api, projectId, "other");
    const custom = await api.domains.create({ serviceId: other.id, hostname: "api.exemple.mg" });

    expect((await api.domains.list({ projectId })).map((d) => d.id)).toEqual([custom.id, generated.id]);
    expect((await api.domains.list({ serviceId: web.id })).map((d) => d.id)).toEqual([generated.id]);

    const updated = await api.domains.update(custom.id, { targetPort: 3001, forceHttps: true });
    expect(updated).toMatchObject({ targetPort: 3001, forceHttps: true, status: "pending_dns" });
    await expectApiError(api.domains.update(custom.id, { forceHttps: "yes" as never }), "validation", "forceHttps");
    await expectApiError(api.domains.update("dom_missing", {}), "not_found");

    await api.domains.delete(custom.id);
    expect((await api.domains.list({ projectId })).map((d) => d.id)).toEqual([generated.id]);
    await expectApiError(api.domains.delete(custom.id), "not_found");
    const [event] = await api.activity.list({ limit: 1 });
    expect(event).toMatchObject({ type: "domain.removed", description: "api.exemple.mg" });
  });

  it("verify queues one DNS check for a public domain", async () => {
    const custom = await api.domains.create({ serviceId: web.id, hostname: "app.exemple.mg" });
    expect((await api.domains.verify(custom.id)).status).toBe("verifying");
    expect((await api.domains.verify(custom.id)).status).toBe("verifying");
    expect(await db().job.count({ where: { type: "domain.verify" } })).toBe(1);
  });
});

describe("publishing once the service has a container", () => {
  /** What the worker records after a successful deployment. */
  async function giveContainer(port = 8080) {
    await db().service.update({ where: { id: web.id }, data: { hostPort: 20_080, port, status: "online" } });
  }

  it("without the privileged helpers the domain ends in error, nothing is run", async () => {
    const generated = await api.domains.generate(web.id);
    await giveContainer();
    const verified = await api.domains.verify(generated.id);
    expect(verified).toMatchObject({ status: "error", error: PROXY_NOT_CONFIGURED });
    expect((await api.services.get(web.id)).primaryDomain).toBeNull();
  });

  it("a target port other than the service port is reported, not published", async () => {
    const generated = await api.domains.generate(web.id);
    await giveContainer(9090);
    const row = await publishDomain(generated.id);
    expect(row?.status).toBe("error");
    expect(row?.error).toContain("(8080)");
    expect(row?.error).toContain("(9090)");
    expect(await publishDomain("dom_missing")).toBeNull();
  });

  it("a public custom domain is never published before its DNS is verified", async () => {
    const custom = await api.domains.create({ serviceId: web.id, hostname: "app.exemple.mg" });
    await giveContainer();
    expect((await publishDomain(custom.id))?.status).toBe("pending_dns");
  });
});

describe("service.primaryDomain", () => {
  async function activate(domainId: string, createdAt: Date) {
    await db().domain.update({ where: { id: domainId }, data: { status: "active", createdAt } });
    await syncPrimaryDomain(db(), web.id);
    return (await api.services.get(web.id)).primaryDomain;
  }

  it("is the oldest active domain, custom before generated, and follows deletions", async () => {
    const generated = await api.domains.generate(web.id);
    const custom = await api.domains.create({ serviceId: web.id, hostname: "app.exemple.mg" });
    const later = await api.domains.create({ serviceId: web.id, hostname: "www.exemple.mg" });

    expect(await activate(generated.id, new Date("2026-01-01"))).toBe(generated.hostname);
    expect(await activate(later.id, new Date("2026-03-01"))).toBe(later.hostname);
    expect(await activate(custom.id, new Date("2026-02-01"))).toBe(custom.hostname);

    // TWINS_PUBLIC_DOMAIN follows the primary domain.
    const builtins = await api.variables.builtins(web.id);
    expect(builtins.find((v) => v.key === "TWINS_PUBLIC_DOMAIN")?.value).toBe(custom.hostname);

    // domains.delete re-syncs it.
    await api.domains.delete(custom.id);
    expect((await api.services.get(web.id)).primaryDomain).toBe(later.hostname);
    await api.domains.delete(later.id);
    expect((await api.services.get(web.id)).primaryDomain).toBe(generated.hostname);
    await api.domains.delete(generated.id);
    expect((await api.services.get(web.id)).primaryDomain).toBeNull();
  });

  it("syncPrimaryDomain reports whether it changed anything", async () => {
    const generated = await api.domains.generate(web.id);
    expect(await syncPrimaryDomain(db(), web.id)).toBe(false);
    await db().domain.update({ where: { id: generated.id }, data: { status: "active" } });
    expect(await syncPrimaryDomain(db(), web.id)).toBe(true);
    expect(await syncPrimaryDomain(db(), web.id)).toBe(false);
    expect(await syncPrimaryDomain(db(), "svc_missing")).toBe(false);
  });
});
