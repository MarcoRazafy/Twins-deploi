import { beforeAll, describe, expect, it } from "vitest";

// Must be set before the module reads it (lazily, on first use).
process.env.MINI_RAILWAY_SECRET_KEY = "ab".repeat(32);

type Crypto = typeof import("@/server/crypto");
let c: Crypto;
beforeAll(async () => {
  c = await import("@/server/crypto");
});

describe("hashPassword / verifyPassword", () => {
  it("aller-retour, mauvais mot de passe, sel aléatoire", async () => {
    const hash = await c.hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await c.verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await c.verifyPassword("wrong password!", hash)).toBe(false);
    expect(await c.hashPassword("correct horse battery")).not.toBe(hash);
  });
  it("refuse un hash mal formé sans lever d'erreur", async () => {
    for (const bad of ["", "nope", "scrypt$1$2", "bcrypt$16384$8$1$aa$bb", "scrypt$abc$8$1$aa$bb", "scrypt$2$8$1$$bb", "scrypt$2$8$1$aa$", "scrypt$9999999$8$1$aa$bb", "scrypt$32768$99$1$aa$bb", "scrypt$32768$8$9$aa$bb"]) {
      expect(await c.verifyPassword("whatever", bad)).toBe(false);
    }
  });
  it("renvoie false pour un hash null (chemin à temps constant)", async () => {
    expect(await c.verifyPassword("whatever", null)).toBe(false);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("aller-retour (y compris vide et unicode)", () => {
    for (const plain of ["", "s3cret", "é€ 漢字 \n"]) {
      expect(c.decryptSecret(c.encryptSecret(plain))).toBe(plain);
    }
  });
  it("format v1 à 4 parties et IV aléatoire", () => {
    const a = c.encryptSecret("x");
    expect(a.split(":")).toHaveLength(4);
    expect(a.startsWith("v1:")).toBe(true);
    expect(c.encryptSecret("x")).not.toBe(a);
  });
  it("détecte une altération du chiffré, de l'étiquette ou de l'IV", () => {
    const [v, iv, tag, data] = c.encryptSecret("secret value").split(":");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(() => c.decryptSecret([v, iv, tag, flip(data)].join(":"))).toThrow();
    expect(() => c.decryptSecret([v, iv, flip(tag), data].join(":"))).toThrow();
    expect(() => c.decryptSecret([v, flip(iv), tag, data].join(":"))).toThrow();
  });
  it("refuse un format inconnu ou tronqué", () => {
    expect(() => c.decryptSecret("v2:a:b:c")).toThrow(/Unsupported/);
    expect(() => c.decryptSecret("v1:a:b")).toThrow(/Unsupported/);
    expect(() => c.decryptSecret("v1:aa:bb:cc")).toThrow(/Malformed/);
  });
});

describe("jetons et comparaisons", () => {
  it("randomToken : longueur base64url", () => {
    const token = c.randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c.randomToken(32)).not.toBe(token);
    expect(c.randomToken(16)).toHaveLength(22);
  });
  it("randomHex, sha256Hex, safeEqual", () => {
    expect(c.randomHex(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(c.sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(c.safeEqual("a", "a")).toBe(true);
    expect(c.safeEqual("a", "b")).toBe(false);
    expect(c.safeEqual("a", "aa")).toBe(false);
  });
});
