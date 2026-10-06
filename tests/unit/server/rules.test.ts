import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/contract";
import {
  CONFIG_LIMITS,
  EMAIL_PATTERN,
  IPV4_PATTERN,
  PASSWORD_MIN_LENGTH,
  assertConfigRanges,
  assertVariableKey,
  asRecord,
  asString,
  inRange,
  isFqdn,
  isValidPort,
  normalizeEmail,
  normalizeHostname,
  sameName,
  toSlug,
  uniqueSlug,
  validEmail,
  validPassword,
  validPersonName,
  validProjectName,
  validServiceName,
} from "@/server/rules";

function failure(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("Aucune erreur levée");
}

describe("lecteurs d'entrées non fiables", () => {
  it("asString / asRecord", () => {
    expect(asString("a")).toBe("a");
    expect(asString(3)).toBe("");
    expect(asString(null)).toBe("");
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1])).toEqual({});
    expect(asRecord(null)).toEqual({});
    expect(asRecord("x")).toEqual({});
  });
  it("inRange", () => {
    expect(inRange(5, 1, 10)).toBe(true);
    expect(inRange(1, 1, 10)).toBe(true);
    expect(inRange(10, 1, 10)).toBe(true);
    expect(inRange(0, 1, 10)).toBe(false);
    expect(inRange(11, 1, 10)).toBe(false);
    expect(inRange(1.5, 1, 10)).toBe(false);
    expect(inRange(1.5, 1, 10, false)).toBe(true);
    expect(inRange(NaN, 1, 10)).toBe(false);
    expect(inRange(Infinity, 1, 10)).toBe(false);
    expect(inRange("5", 1, 10)).toBe(false);
  });
  it("sameName ignore casse et espaces", () => {
    expect(sameName(" Mon App ", "mon app")).toBe(true);
    expect(sameName("a", "b")).toBe(false);
  });
});

describe("noms", () => {
  it.each([
    ["validProjectName", validProjectName, 40],
    ["validServiceName", validServiceName, 40],
    ["validPersonName", validPersonName, 60],
  ] as const)("%s : bornes et trim", (_n, fn, max) => {
    expect(fn("  ab  ")).toBe("ab");
    expect(fn("a".repeat(max))).toBe("a".repeat(max));
    for (const bad of ["a", " a ", "", "a".repeat(max + 1), 42, null, undefined]) {
      const error = failure(() => fn(bad));
      expect(error.code).toBe("validation");
      expect(error.field).toBe("name");
    }
  });
});

describe("slugs", () => {
  it("toSlug", () => {
    expect(toSlug("Mon Projet Été", "x")).toBe("mon-projet-ete");
    expect(toSlug("!!!", "projet")).toBe("projet");
    expect(toSlug("a".repeat(60), "x")).toHaveLength(40);
    expect(toSlug(`${"a".repeat(39)} b`, "x")).toBe("a".repeat(39));
  });
  it("uniqueSlug", () => {
    expect(uniqueSlug("app", [])).toBe("app");
    expect(uniqueSlug("app", ["app"])).toBe("app-2");
    expect(uniqueSlug("app", new Set(["app", "app-2", "app-3"]))).toBe("app-4");
  });
});

describe("assertVariableKey", () => {
  it.each(["KEY", "_x", "a1", "DATABASE_URL", "PORT", "twins"])("accepte %s", (key) => {
    expect(() => assertVariableKey(key)).not.toThrow();
  });
  it.each(["", 5, null, undefined])("exige un nom (%s)", (key) => {
    const error = failure(() => assertVariableKey(key));
    expect(error).toMatchObject({ code: "validation", field: "key" });
    expect(error.message).toContain("requis");
  });
  it.each(["1A", "a-b", "a b", "é", "A.B"])("refuse le nom invalide %s", (key) => {
    const error = failure(() => assertVariableKey(key));
    expect(error).toMatchObject({ code: "validation", field: "key" });
    expect(error.message).toContain("valide");
  });
  it("réserve le préfixe TWINS_", () => {
    const error = failure(() => assertVariableKey("TWINS_PUBLIC_DOMAIN"));
    expect(error).toMatchObject({ code: "validation", field: "key" });
    expect(error.message).toContain("réservés");
  });
});

describe("hôtes", () => {
  it("isFqdn", () => {
    for (const ok of ["app.exemple.mg", "a.b.c.io", "x-y.example.com", "a1.co"]) expect(isFqdn(ok)).toBe(true);
    for (const bad of ["localhost", "-a.com", "a-.com", "a..com", "a.c", "a.123", "a_b.com", "A.com", `${"a".repeat(64)}.com`, `${"a.".repeat(130)}com`, ""]) {
      expect(isFqdn(bad)).toBe(false);
    }
  });
  it("normalizeHostname", () => {
    expect(normalizeHostname("  App.Exemple.MG. ")).toBe("app.exemple.mg");
    expect(normalizeHostname(undefined)).toBe("");
  });
  it("IPV4_PATTERN", () => {
    for (const ok of ["1.2.3.4", "255.255.255.255", "0.0.0.0", "192.168.1.10"]) expect(IPV4_PATTERN.test(ok)).toBe(true);
    for (const bad of ["256.1.1.1", "1.2.3", "1.2.3.4.5", "a.b.c.d", "1.2.3.-1"]) expect(IPV4_PATTERN.test(bad)).toBe(false);
  });
});

describe("e-mails", () => {
  it("validEmail normalise", () => {
    expect(validEmail("  Marco@Example.MG ")).toBe("marco@example.mg");
    expect(normalizeEmail(null)).toBe("");
  });
  it.each(["", "a", "a@b", "a@b.c", "a b@c.de", "@c.de", "a@@c.de", 12, `${"a".repeat(250)}@b.de`])(
    "refuse %s",
    (value) => {
      expect(failure(() => validEmail(value))).toMatchObject({ code: "validation", field: "email" });
    },
  );
  it("EMAIL_PATTERN", () => {
    expect(EMAIL_PATTERN.test("a@b.cd")).toBe(true);
  });
});

describe("mots de passe", () => {
  it("accepte 10 à 200 caractères sans modifier", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(validPassword(" ".repeat(10))).toBe(" ".repeat(10));
    expect(validPassword("x".repeat(200))).toHaveLength(200);
  });
  it("refuse trop court / trop long / non-chaîne", () => {
    for (const bad of ["x".repeat(9), "x".repeat(201), "", null, 1234567890]) {
      expect(failure(() => validPassword(bad))).toMatchObject({ code: "validation", field: "password" });
    }
  });
});

describe("configuration de service", () => {
  const ok = { port: 3000, replicas: 1, cpuLimit: 0.5, memoryLimitMb: 512 };
  it("accepte une config valide et les bornes", () => {
    expect(() => assertConfigRanges(ok)).not.toThrow();
    expect(() =>
      assertConfigRanges({ port: 65_535, replicas: 5, cpuLimit: 8, memoryLimitMb: 16_384 }),
    ).not.toThrow();
    expect(() =>
      assertConfigRanges({ port: 1, replicas: 1, cpuLimit: 0.25, memoryLimitMb: 128 }),
    ).not.toThrow();
    expect(CONFIG_LIMITS.port.max).toBe(65_535);
  });
  it.each([
    [{ port: 0 }, "config.port"],
    [{ port: 65_536 }, "config.port"],
    [{ port: 80.5 }, "config.port"],
    [{ replicas: 0 }, "config.replicas"],
    [{ replicas: 6 }, "config.replicas"],
    [{ cpuLimit: 0.1 }, "config.cpuLimit"],
    [{ cpuLimit: 9 }, "config.cpuLimit"],
    [{ memoryLimitMb: 127 }, "config.memoryLimitMb"],
    [{ memoryLimitMb: 16_385 }, "config.memoryLimitMb"],
  ])("refuse %j", (patch, field) => {
    expect(failure(() => assertConfigRanges({ ...ok, ...patch }))).toMatchObject({ code: "validation", field });
  });
  it("isValidPort", () => {
    expect(isValidPort(8080)).toBe(true);
    expect(isValidPort("8080")).toBe(false);
    expect(isValidPort(0)).toBe(false);
  });
});
