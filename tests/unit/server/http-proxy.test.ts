import { describe, expect, it } from "vitest";

import { CSRF_HEADER, clientAddress, passesCsrf } from "@/server/http";
import { APP_PORT_RANGE, isLocalHostname } from "@/server/proxy";

const h = (init: Record<string, string>) => new Headers(init);

describe("passesCsrf", () => {
  it("refuse sans l'en-tête personnalisé", () => {
    expect(passesCsrf(h({ host: "app.test" }))).toBe(false);
    expect(passesCsrf(h({ host: "app.test", origin: "http://app.test" }))).toBe(false);
  });
  it("accepte sans Origin", () => {
    expect(passesCsrf(h({ [CSRF_HEADER]: "1", host: "app.test" }))).toBe(true);
  });
  it("accepte une origine égale à l'hôte (casse ignorée, port compris)", () => {
    expect(passesCsrf(h({ [CSRF_HEADER]: "1", host: "App.test:3000", origin: "http://app.TEST:3000" }))).toBe(true);
  });
  it("accepte via x-forwarded-host (premier élément)", () => {
    expect(
      passesCsrf(h({ [CSRF_HEADER]: "1", host: "127.0.0.1:3000", "x-forwarded-host": "app.mg, proxy", origin: "https://app.mg" })),
    ).toBe(true);
  });
  it("refuse une origine différente ou un port différent", () => {
    expect(passesCsrf(h({ [CSRF_HEADER]: "1", host: "app.test", origin: "http://evil.test" }))).toBe(false);
    expect(passesCsrf(h({ [CSRF_HEADER]: "1", host: "app.test:3000", origin: "http://app.test:4000" }))).toBe(false);
  });
  it("refuse une Origin illisible ou 'null'", () => {
    expect(passesCsrf(h({ [CSRF_HEADER]: "1", host: "app.test", origin: "pas une url" }))).toBe(false);
    expect(passesCsrf(h({ [CSRF_HEADER]: "1", host: "app.test", origin: "null" }))).toBe(false);
  });
  it("refuse une Origin quand aucun hôte n'est connu", () => {
    expect(passesCsrf(h({ [CSRF_HEADER]: "1", origin: "http://app.test" }))).toBe(false);
  });
});

describe("clientAddress", () => {
  it("prend la dernière adresse de x-forwarded-for, sinon local", () => {
    expect(clientAddress(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientAddress(h({}))).toBe("local");
  });
});

describe("proxy (exports purs)", () => {
  it("isLocalHostname", () => {
    expect(isLocalHostname("app.test")).toBe(true);
    expect(isLocalHostname("app.localhost")).toBe(true);
    expect(isLocalHostname("app.example.mg")).toBe(false);
    expect(isLocalHostname("test")).toBe(false);
    expect(isLocalHostname("app.test.mg")).toBe(false);
  });
  it("APP_PORT_RANGE", () => {
    expect(APP_PORT_RANGE).toEqual({ min: 20_000, max: 29_999 });
  });
});
