import { beforeAll, describe, expect, it } from "vitest";

import { isApiError, type Api } from "@/lib/api/contract";
import type { MemberRole, UserProfile } from "@/lib/types";
import { hasRole, minimumRole } from "@/server/context";
import { httpStatusFor } from "@/server/errors";
import { resetDatabase } from "../helpers/db";
import { anonymousApi, apiAs, createMember, deployImage, expectApiError, setupOwner } from "../helpers/api";

/** One database for the whole file: every case below only reads, or writes uniquely named rows. */
let users: Record<MemberRole, UserProfile>;
let projectId: string;
let serviceId: string;
let counter = 0;

beforeAll(async () => {
  await resetDatabase();
  const owner = await setupOwner();
  users = {
    owner,
    admin: await createMember(owner, "admin"),
    developer: await createMember(owner, "developer"),
    viewer: await createMember(owner, "viewer"),
  };
  const api = apiAs(owner);
  projectId = (await api.projects.create({ name: "Droits" })).id;
  serviceId = (await deployImage(api, projectId, "web")).id;
});

describe("minimumRole", () => {
  it("follows the documented rules", () => {
    expect(minimumRole("auth.login")).toBeNull();
    expect(minimumRole("projects.list")).toBe("viewer");
    expect(minimumRole("deployments.getLogs")).toBe("viewer");
    expect(minimumRole("docker.searchHub")).toBe("viewer");
    // Sensitive reads: secrets travel with them.
    expect(minimumRole("variables.list")).toBe("developer");
    expect(minimumRole("databases.get")).toBe("developer");
    expect(minimumRole("databases.startCommand")).toBe("developer");
    expect(minimumRole("databases.getCommand")).toBe("developer");
    expect(minimumRole("projects.create")).toBe("developer");
    expect(minimumRole("projects.delete")).toBe("developer");
    expect(minimumRole("settings.update")).toBe("admin");
    expect(minimumRole("settings.inviteMember")).toBe("admin");
    // A developer manages their own account.
    expect(minimumRole("settings.updateProfile")).toBe("developer");
    expect(minimumRole("settings.createToken")).toBe("developer");
  });
});

describe("anonymous visitor", () => {
  it("is refused with forbidden (HTTP 401) outside auth.*", async () => {
    const api = anonymousApi();
    const error = await expectApiError(api.projects.list(), "forbidden");
    expect(error.message).toBe("Vous devez être connecté pour effectuer cette action.");
    expect(httpStatusFor(error, false)).toBe(401);
    await expectApiError(api.variables.list({ projectId }), "forbidden");
    await expectApiError(api.projects.create({ name: "Anonyme" }), "forbidden");
    expect((await api.auth.getSession()).status).toBe("unauthenticated");
  });
});

type Call = (api: Api) => Promise<unknown>;

/** Method name → a call with valid arguments (writes use fresh names, so any role may succeed). */
const CALLS: Array<[string, Call]> = [
  ["projects.list", (api) => api.projects.list()],
  ["projects.get", (api) => api.projects.get(projectId)],
  ["services.list", (api) => api.services.list({ projectId })],
  ["deployments.list", (api) => api.deployments.list({ serviceId })],
  ["activity.list", (api) => api.activity.list()],
  ["settings.get", (api) => api.settings.get()],
  ["settings.listMembers", (api) => api.settings.listMembers()],
  ["variables.list", (api) => api.variables.list({ projectId })],
  ["databases.list", (api) => api.databases.list({ projectId })],
  ["projects.create", (api) => api.projects.create({ name: `Projet ${++counter}` })],
  [
    "variables.create",
    (api) => api.variables.create({ projectId, serviceId: null, key: `KEY_${++counter}`, value: "v" }),
  ],
  [
    "projects.delete",
    async (api) => {
      const doomed = await apiAs(users.owner).projects.create({ name: `Jetable ${++counter}` });
      return api.projects.delete(doomed.id);
    },
  ],
  ["settings.updateProfile", (api) => api.settings.updateProfile({})],
  ["settings.update", (api) => api.settings.update({ workspaceName: `Atelier ${++counter}` })],
  ["settings.inviteMember", (api) => api.settings.inviteMember({ email: `m${++counter}@example.test`, role: "viewer" })],
];

const ROLES: MemberRole[] = ["viewer", "developer", "admin", "owner"];

describe.each(ROLES)("role %s", (role) => {
  it.each(CALLS)("%s is allowed exactly when minimumRole permits it", async (method, call) => {
    const minimum = minimumRole(method);
    const allowed = minimum === null || hasRole(role, minimum);
    const outcome = await call(apiAs(users[role])).then(
      () => "ok" as const,
      (error: unknown) => error,
    );
    if (allowed) {
      expect(outcome).toBe("ok");
    } else {
      expect(isApiError(outcome) && outcome.code).toBe("forbidden");
      expect(isApiError(outcome) && httpStatusFor(outcome, true)).toBe(403);
    }
  });
});

describe("concrete expectations", () => {
  it("a viewer lists projects but cannot read variables or databases, nor create", async () => {
    const viewer = apiAs(users.viewer);
    expect((await viewer.projects.list()).map((project) => project.id)).toContain(projectId);
    await expectApiError(viewer.variables.list({ projectId }), "forbidden");
    await expectApiError(viewer.databases.list({ projectId }), "forbidden");
    await expectApiError(viewer.docker.deployImage({ projectId, image: "redis" }), "forbidden");
  });

  it("a developer creates variables, an admin and the owner delete projects", async () => {
    const created = await apiAs(users.developer).variables.create({
      projectId,
      serviceId,
      key: "DEV_KEY",
      value: "1",
    });
    expect(created.key).toBe("DEV_KEY");
    for (const role of ["admin", "owner"] as const) {
      const doomed = await apiAs(users.owner).projects.create({ name: `À supprimer ${role}` });
      await apiAs(users[role]).projects.delete(doomed.id);
      await expectApiError(apiAs(users.owner).projects.get(doomed.id), "not_found");
    }
  });

  it("only an admin manages members, and nobody can grant or alter the owner role", async () => {
    await expectApiError(
      apiAs(users.developer).settings.inviteMember({ email: "x@example.test", role: "viewer" }),
      "forbidden",
    );
    await expectApiError(
      apiAs(users.admin).settings.inviteMember({ email: "boss@example.test", role: "owner" }),
      "forbidden",
    );
    await expectApiError(apiAs(users.admin).settings.updateMember(users.owner.id, { role: "viewer" }), "forbidden");
    await expectApiError(apiAs(users.admin).settings.removeMember(users.owner.id), "forbidden");
  });
});
