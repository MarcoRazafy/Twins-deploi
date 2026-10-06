import { beforeEach, describe, expect, it } from "vitest";

import { createServerApi } from "@/server/api";
import { authenticate } from "@/server/auth";
import { anonymousContext, type Context } from "@/server/context";
import { db } from "@/server/db";
import { resetDatabase } from "../helpers/db";
import { apiAs, expectApiError, OWNER, setupOwner } from "../helpers/api";

let addressCounter = 0;

/** A browser: remembers the session cookie the API sets or clears. */
function browser(address = `10.0.0.${++addressCounter}`) {
  const jar: { token: string | null } = { token: null };
  const ctx = (): Context => ({
    ...anonymousContext(),
    client: { address, userAgent: "vitest" },
    session: {
      token: jar.token,
      set: (token) => {
        jar.token = token;
      },
      clear: () => {
        jar.token = null;
      },
    },
  });
  return { jar, api: () => createServerApi(ctx()) };
}

describe("auth.setup", () => {
  beforeEach(resetDatabase);

  it("creates the owner once, signs in, then refuses a second setup", async () => {
    const visitor = browser();
    const session = await visitor.api().auth.setup({ ...OWNER, email: "  Owner@Example.TEST " });
    expect(session.status).toBe("authenticated");
    expect(session.user).toMatchObject({ name: OWNER.name, email: "owner@example.test", role: "owner" });
    expect(visitor.jar.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = await db().user.findUniqueOrThrow({ where: { email: "owner@example.test" } });
    expect(row.passwordHash).not.toContain(OWNER.password);

    await expectApiError(
      browser().api().auth.setup({ name: "Intrus", email: "other@example.test", password: "Autre-mot-de-passe" }),
      "forbidden",
    );
    expect(await db().user.count()).toBe(1);
  });

  it("validates the name, the e-mail and the password", async () => {
    const api = browser().api();
    await expectApiError(api.auth.setup({ ...OWNER, name: "A" }), "validation", "name");
    await expectApiError(api.auth.setup({ ...OWNER, email: "not-an-email" }), "validation", "email");
    await expectApiError(api.auth.setup({ ...OWNER, password: "short" }), "validation", "password");
    await expectApiError(api.auth.setup({ ...OWNER, password: "x".repeat(201) }), "validation", "password");
    // Exactly 10 characters is enough.
    const session = await api.auth.setup({ ...OWNER, password: "0123456789" });
    expect(session.user?.role).toBe("owner");
  });
});

describe("auth.getSession", () => {
  beforeEach(resetDatabase);

  it("says setup_required, then unauthenticated, then authenticated", async () => {
    const anonymous = createServerApi(anonymousContext());
    expect(await anonymous.auth.getSession()).toEqual({ status: "setup_required", user: null });
    const owner = await setupOwner();
    expect(await anonymous.auth.getSession()).toEqual({ status: "unauthenticated", user: null });
    expect(await apiAs(owner).auth.getSession()).toEqual({ status: "authenticated", user: owner });
  });
});

describe("auth.login / logout", () => {
  beforeEach(async () => {
    await resetDatabase();
    await setupOwner();
  });

  it("signs in with the right password (e-mail case-insensitive) and the cookie authenticates", async () => {
    const visitor = browser();
    const session = await visitor.api().auth.login({ email: " OWNER@example.test", password: OWNER.password });
    expect(session).toMatchObject({ status: "authenticated", user: { email: OWNER.email, role: "owner" } });
    expect(visitor.jar.token).not.toBeNull();

    const identity = await authenticate({ sessionToken: visitor.jar.token, authorization: null });
    expect(identity).toMatchObject({ via: "session", user: { email: OWNER.email } });
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    const api = browser().api();
    const wrong = await expectApiError(api.auth.login({ email: OWNER.email, password: "mauvais-mot-de-passe" }), "forbidden");
    const unknown = await expectApiError(api.auth.login({ email: "nobody@example.test", password: OWNER.password }), "forbidden");
    const malformed = await expectApiError(api.auth.login({ email: "", password: "" }), "forbidden");
    expect(wrong.message).toBe("E-mail ou mot de passe incorrect.");
    expect(unknown.message).toBe(wrong.message);
    expect(malformed.message).toBe(wrong.message);
  });

  it("refuses an invited member who has no password yet", async () => {
    await db().user.create({
      data: { id: "usr_invited", name: "Invité", email: "invited@example.test", role: "developer", status: "invited" },
    });
    const error = await expectApiError(
      browser().api().auth.login({ email: "invited@example.test", password: OWNER.password }),
      "forbidden",
    );
    expect(error.message).toBe("E-mail ou mot de passe incorrect.");
  });

  it("logout destroys the session and clears the cookie", async () => {
    const visitor = browser();
    await visitor.api().auth.login({ email: OWNER.email, password: OWNER.password });
    const token = visitor.jar.token;
    // The owner's setup session + this one.
    expect(await db().session.count()).toBe(2);

    await visitor.api().auth.logout();
    expect(visitor.jar.token).toBeNull();
    expect(await db().session.count()).toBe(1);
    const identity = await authenticate({ sessionToken: token, authorization: null });
    expect(identity).toEqual({ user: null, via: "anonymous", refreshed: false });
  });

  it("a new login replaces the session the browser still carries", async () => {
    const visitor = browser();
    await visitor.api().auth.login({ email: OWNER.email, password: OWNER.password });
    const first = visitor.jar.token;
    await visitor.api().auth.login({ email: OWNER.email, password: OWNER.password });
    expect(visitor.jar.token).not.toBe(first);
    expect((await authenticate({ sessionToken: first, authorization: null })).user).toBeNull();
  });

  it("locks an address + e-mail pair after 5 failures, even for the right password", async () => {
    const visitor = browser();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const error = await expectApiError(
        visitor.api().auth.login({ email: OWNER.email, password: `faux-${attempt}-password` }),
        "forbidden",
      );
      expect(error.message).toBe("E-mail ou mot de passe incorrect.");
    }
    const locked = await expectApiError(
      visitor.api().auth.login({ email: OWNER.email, password: OWNER.password }),
      "forbidden",
    );
    expect(locked.message).toBe("Trop de tentatives de connexion. Réessayez dans une minute.");

    // Another client address is not affected.
    const session = await browser().api().auth.login({ email: OWNER.email, password: OWNER.password });
    expect(session.status).toBe("authenticated");
  });

  it("a successful login resets the failure counter", async () => {
    const visitor = browser();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expectApiError(visitor.api().auth.login({ email: OWNER.email, password: "mauvais-mdp-123" }), "forbidden");
    }
    await visitor.api().auth.login({ email: OWNER.email, password: OWNER.password });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const error = await expectApiError(
        visitor.api().auth.login({ email: OWNER.email, password: "mauvais-mdp-123" }),
        "forbidden",
      );
      expect(error.message).toBe("E-mail ou mot de passe incorrect.");
    }
  });
});
