import { describe, expect, it } from "vitest";

import { formatSessionDuration, isSameOrigin, sessionTokenFromCookies } from "@/server/terminal/policy";
import { toServerConsoleStatus } from "@/server/terminal/settings";

describe("isSameOrigin", () => {
  it("accepts the origin of the host that was called (through the proxy or directly)", () => {
    expect(
      isSameOrigin(
        new Headers({ origin: "https://deploy.example.mg", host: "127.0.0.1:3101", "x-forwarded-host": "deploy.example.mg" }),
      ),
    ).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
  });

  it("refuses a missing origin: a WebSocket from a browser always carries one", () => {
    expect(isSameOrigin(new Headers({ host: "deploy.example.mg" }))).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "", host: "deploy.example.mg" }))).toBe(false);
  });

  it("refuses another site, another port, an opaque or malformed origin", () => {
    const called = { host: "127.0.0.1:3101", "x-forwarded-host": "deploy.example.mg" };
    expect(isSameOrigin(new Headers({ ...called, origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(new Headers({ ...called, origin: "https://deploy.example.mg:8443" }))).toBe(false);
    expect(isSameOrigin(new Headers({ ...called, origin: "https://deploy.example.mg.evil.example" }))).toBe(false);
    expect(isSameOrigin(new Headers({ ...called, origin: "null" }))).toBe(false);
    expect(isSameOrigin(new Headers({ ...called, origin: "file://deploy.example.mg" }))).toBe(false);
  });

  it("trusts the forwarded host over Host, which is the service's own address behind the proxy", () => {
    expect(
      isSameOrigin(new Headers({ origin: "http://127.0.0.1:3101", host: "127.0.0.1:3101", "x-forwarded-host": "deploy.example.mg" })),
    ).toBe(false);
  });
});

describe("sessionTokenFromCookies", () => {
  it("finds the session cookie among others", () => {
    expect(sessionTokenFromCookies("theme=dark; mr_session=abc123; other=1")).toBe("abc123");
    expect(sessionTokenFromCookies("mr_session=abc=")).toBe("abc=");
  });

  it("returns null without it", () => {
    expect(sessionTokenFromCookies(null)).toBeNull();
    expect(sessionTokenFromCookies("")).toBeNull();
    expect(sessionTokenFromCookies("xmr_session=abc; mr_session_old=def")).toBeNull();
    expect(sessionTokenFromCookies("mr_session=")).toBeNull();
  });
});

describe("toServerConsoleStatus", () => {
  it("is disabled unless the stored value says exactly enabled: true", () => {
    expect(toServerConsoleStatus(null).enabled).toBe(false);
    expect(toServerConsoleStatus("true").enabled).toBe(false);
    expect(toServerConsoleStatus({ enabled: "true" }).enabled).toBe(false);
    expect(toServerConsoleStatus({ enabled: 1 }).enabled).toBe(false);
    expect(toServerConsoleStatus({ enabled: true, updatedBy: "a@b.c", updatedAt: "2026-10-13T00:00:00.000Z" })).toEqual({
      enabled: true,
      updatedBy: "a@b.c",
      updatedAt: "2026-10-13T00:00:00.000Z",
    });
  });
});

describe("formatSessionDuration", () => {
  it("is readable in the journal", () => {
    expect(formatSessionDuration(5_000)).toBe("moins d’une minute");
    expect(formatSessionDuration(12 * 60_000)).toBe("12 min");
    expect(formatSessionDuration(65 * 60_000)).toBe("1 h 05");
  });
});
