import { describe, expect, it } from "vitest";

import {
  builtinVariables,
  isBuiltinVariableKey,
  pickPublicDomain,
  privateDomainOf,
  type BuiltinVariableSource,
} from "@/lib/variables/builtin";

const isLocal = (hostname: string) => hostname.endsWith(".test") || hostname.endsWith(".localhost");

function source(over: Partial<BuiltinVariableSource> = {}): BuiltinVariableSource {
  return {
    project: { id: "prj_1", name: "Mon Projet", slug: "mon-projet", environment: "production", region: "Madagascar" },
    service: { id: "svc_1", name: "API", slug: "api", port: 3000, volume: null },
    publicDomain: "api.example.mg",
    deploymentId: "dep_1",
    ...over,
  };
}

const toMap = (s: BuiltinVariableSource) =>
  Object.fromEntries(builtinVariables(s).map((v) => [v.key, v.value]));

describe("builtinVariables", () => {
  it("fournit PORT et les variables TWINS_* sans volume", () => {
    expect(toMap(source())).toEqual({
      PORT: "3000",
      TWINS_PUBLIC_DOMAIN: "api.example.mg",
      TWINS_PRIVATE_DOMAIN: "api.twinsdeploi.internal",
      TWINS_PROJECT_NAME: "Mon Projet",
      TWINS_PROJECT_ID: "prj_1",
      TWINS_SERVICE_NAME: "API",
      TWINS_SERVICE_ID: "svc_1",
      TWINS_ENVIRONMENT_NAME: "production",
      TWINS_REGION: "Madagascar",
      TWINS_DEPLOYMENT_ID: "dep_1",
    });
  });

  it("ajoute les clés de volume seulement avec un volume", () => {
    const map = toMap(source({ service: { ...source().service, volume: { name: "data", mountPath: "/data" } } }));
    expect(map.TWINS_VOLUME_NAME).toBe("data");
    expect(map.TWINS_VOLUME_MOUNT_PATH).toBe("/data");
    expect(toMap(source())).not.toHaveProperty("TWINS_VOLUME_NAME");
  });

  it("laisse vides le domaine public et le déploiement quand ils sont null", () => {
    const map = toMap(source({ publicDomain: null, deploymentId: null }));
    expect(map.TWINS_PUBLIC_DOMAIN).toBe("");
    expect(map.TWINS_DEPLOYMENT_ID).toBe("");
  });

  it("donne une description française à chaque variable", () => {
    for (const v of builtinVariables(source())) expect(v.description.length).toBeGreaterThan(5);
  });
});

describe("pickPublicDomain", () => {
  const d = (hostname: string, kind: string, status: string) => ({ hostname, kind, status });

  it("le domaine principal l'emporte", () => {
    expect(pickPublicDomain("main.mg", [d("a.mg", "custom", "active")], isLocal)).toBe("main.mg");
  });
  it("custom actif > généré > local", () => {
    const domains = [d("x.test", "local", "active"), d("g.base.mg", "generated", "active"), d("c.mg", "custom", "active")];
    expect(pickPublicDomain(null, domains, isLocal)).toBe("c.mg");
    expect(pickPublicDomain(null, domains.slice(0, 2), isLocal)).toBe("g.base.mg");
    expect(pickPublicDomain(null, domains.slice(0, 1), isLocal)).toBe("x.test");
  });
  it("ignore un domaine custom en attente", () => {
    expect(pickPublicDomain(null, [d("c.mg", "custom", "pending_dns")], isLocal)).toBeNull();
    expect(pickPublicDomain(null, [d("c.mg", "custom", "pending_dns"), d("g.mg", "generated", "active")], isLocal)).toBe("g.mg");
  });
  it("ignore un hostname non local de type autre", () => {
    expect(pickPublicDomain(null, [d("x.example.com", "other", "active")], isLocal)).toBeNull();
  });
  it("aucun domaine -> null", () => {
    expect(pickPublicDomain(null, [], isLocal)).toBeNull();
    expect(pickPublicDomain("", [], isLocal)).toBeNull();
  });
});

describe("isBuiltinVariableKey / privateDomainOf", () => {
  it("reconnaît PORT et le préfixe TWINS_", () => {
    expect(isBuiltinVariableKey("PORT")).toBe(true);
    expect(isBuiltinVariableKey("TWINS_REGION")).toBe(true);
    expect(isBuiltinVariableKey("TWINS_")).toBe(true);
  });
  it("refuse le reste (sensible à la casse)", () => {
    for (const key of ["port", "MY_PORT", "TWINSX", "twins_region", "DATABASE_URL", ""]) {
      expect(isBuiltinVariableKey(key)).toBe(false);
    }
  });
  it("calcule le nom privé", () => {
    expect(privateDomainOf("web")).toBe("web.twinsdeploi.internal");
  });
});
