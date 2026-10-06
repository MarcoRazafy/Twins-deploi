import { beforeEach, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { UserProfile } from "@/lib/types";
import { authenticate } from "@/server/auth";
import { db } from "@/server/db";
import { resetDatabase } from "../helpers/db";
import { apiAs, createMember, expectApiError, setupOwner } from "../helpers/api";

let owner: UserProfile;
let api: Api;

beforeEach(async () => {
  await resetDatabase();
  owner = await setupOwner();
  api = apiAs(owner);
});

describe("settings.get / update", () => {
  it("starts from the defaults (base domain from the environment)", async () => {
    const settings = await api.settings.get();
    expect(settings).toMatchObject({
      workspaceName: "TwinsDeploi",
      baseDomain: "platform.test",
      defaultRegion: "mg-analamanga",
      dns: { provider: "manual", cnameTarget: "ingress.platform.test" },
    });
  });

  it("round-trips a deep partial patch, ignores unknown keys and wrong types", async () => {
    const updated = await api.settings.update({
      workspaceName: "  Atelier  ",
      baseDomain: "Apps.Exemple.MG",
      deployments: { retention: 5 },
      nginx: { gzip: false, clientMaxBodySizeMb: "beaucoup" as never },
      ...({ unknown: true } as object),
    });
    expect(updated).toMatchObject({ workspaceName: "Atelier", baseDomain: "apps.exemple.mg" });
    expect(updated.deployments).toMatchObject({ retention: 5, buildTimeoutMin: 20, autoDeploy: true });
    expect(updated.nginx).toMatchObject({ gzip: false, clientMaxBodySizeMb: 50 });
    expect(updated).not.toHaveProperty("unknown");
    expect(await api.settings.get()).toEqual(updated);

    const [event] = await api.activity.list({ limit: 1 });
    expect(event).toMatchObject({ type: "settings.updated", title: "Réglages de la plateforme modifiés", actor: owner.name });
  });

  it("validates the whole document and keeps the previous one on error", async () => {
    await expectApiError(api.settings.update({ workspaceName: "A" }), "validation", "workspaceName");
    await expectApiError(api.settings.update({ baseDomain: "pas un domaine" }), "validation", "baseDomain");
    await expectApiError(api.settings.update({ deployments: { retention: 0 } }), "validation", "deployments.retention");
    await expectApiError(api.settings.update({ docker: { socketPath: "relative.sock" } }), "validation", "docker.socketPath");
    await expectApiError(api.settings.update({ dns: { serverIp: "300.1.1.1" } }), "validation", "dns.serverIp");
    expect((await api.settings.get()).workspaceName).toBe("TwinsDeploi");
  });

  it("new projects and generated domains use the saved settings", async () => {
    await api.settings.update({ baseDomain: "apps.exemple.mg", docker: { defaultMemoryLimitMb: 1024 } });
    const project = await api.projects.create({ name: "Réglages" });
    const service = await api.docker.deployImage({ projectId: project.id, image: "nginx" });
    expect(service.config.memoryLimitMb).toBe(1024);
    const domain = await api.domains.generate(service.id);
    expect(domain.hostname).toMatch(/\.apps\.exemple\.mg$/);
  });
});

describe("settings members", () => {
  it("invites, lists (owner first), changes the role and removes", async () => {
    const member = await api.settings.inviteMember({ email: "Hery.Rakoto@Exemple.MG", role: "developer" });
    expect(member).toMatchObject({ email: "hery.rakoto@exemple.mg", name: "Hery Rakoto", role: "developer", status: "invited" });
    await expectApiError(api.settings.inviteMember({ email: "hery.rakoto@exemple.mg", role: "viewer" }), "conflict", "email");
    await expectApiError(api.settings.inviteMember({ email: "x@exemple.mg", role: "boss" as never }), "validation", "role");

    const members = await api.settings.listMembers();
    expect(members.map((m) => m.role)).toEqual(["owner", "developer"]);

    expect((await api.settings.updateMember(member.id, { role: "admin" })).role).toBe("admin");
    await expectApiError(api.settings.updateMember(member.id, { role: "owner" }), "forbidden");
    await expectApiError(api.settings.updateMember("usr_missing", { role: "viewer" }), "not_found");

    await api.settings.removeMember(member.id);
    expect(await api.settings.listMembers()).toHaveLength(1);
    await expectApiError(api.settings.removeMember(member.id), "not_found");
  });
});

describe("settings profile and tokens", () => {
  it("updates the caller's profile and refuses an e-mail already used", async () => {
    const developer = await createMember(owner, "developer");
    const mine = apiAs(developer);
    const updated = await mine.settings.updateProfile({ name: "Nouveau Nom", email: "NEW@example.test" });
    expect(updated).toMatchObject({ id: developer.id, name: "Nouveau Nom", email: "new@example.test" });
    await expectApiError(mine.settings.updateProfile({ email: owner.email }), "conflict", "email");
    await expectApiError(mine.settings.updateProfile({ avatarUrl: "http://x/y.png" }), "validation", "avatarUrl");

    const photo = "data:image/png;base64,iVBORw0KGgo=";
    expect((await mine.settings.updateProfile({ avatarUrl: photo })).avatarUrl).toBe(photo);
    expect((await mine.settings.updateProfile({ avatarUrl: null })).avatarUrl).toBeNull();
  });

  it("creates a token whose secret authenticates, then revokes it", async () => {
    const { token, secret } = await api.settings.createToken({ name: "CI", expiresInDays: 30 });
    expect(secret).toMatch(/^mr_live_[0-9a-f]{32}$/);
    expect(token).toMatchObject({ name: "CI", prefix: secret.slice(0, 12), lastUsedAt: null });
    expect(token).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(await api.settings.listTokens())).not.toContain(secret);

    const identity = await authenticate({ sessionToken: null, authorization: `Bearer ${secret}` });
    expect(identity).toMatchObject({ via: "token", user: { id: owner.id } });

    await expectApiError(api.settings.createToken({ name: "ci" }), "conflict", "name");
    await expectApiError(api.settings.createToken({ name: "Long", expiresInDays: 400 }), "validation", "expiresInDays");

    await api.settings.revokeToken(token.id);
    expect(await api.settings.listTokens()).toEqual([]);
    expect((await authenticate({ sessionToken: null, authorization: `Bearer ${secret}` })).user).toBeNull();
  });

  it("a token cannot be revoked by another member", async () => {
    const { token } = await api.settings.createToken({ name: "Owner token" });
    const admin = await createMember(owner, "admin");
    await expectApiError(apiAs(admin).settings.revokeToken(token.id), "not_found");
    expect(await db().apiToken.count()).toBe(1);
  });

  it("removing a member signs them out everywhere", async () => {
    const developer = await createMember(owner, "developer");
    const { secret } = await apiAs(developer).settings.createToken({ name: "Dev token" });
    await api.settings.removeMember(developer.id);
    expect((await authenticate({ sessionToken: null, authorization: `Bearer ${secret}` })).user).toBeNull();
  });

  it("resetDemoData only exists in the simulator", async () => {
    await expectApiError(api.settings.resetDemoData(), "forbidden");
  });
});
