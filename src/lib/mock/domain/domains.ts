import type { DnsRecord, Domain, ID } from "@/lib/types";

import type { MockDb } from "../schema";
import { DAY, iso } from "../text";

/** Public suffixes made of two labels, so "shop.co.mg" is an apex and not a subdomain. */
const TWO_LABEL_SUFFIXES = new Set([
  "co.mg", "com.mg", "org.mg", "gov.mg", "edu.mg", "nom.mg", "prd.mg", "tm.mg",
  "co.uk", "org.uk", "com.au", "co.za", "com.br", "co.jp", "co.nz", "com.fr",
]);

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isFqdn(hostname: string): boolean {
  if (hostname.length > 253) return false;
  const labels = hostname.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => LABEL.test(label))) return false;
  return /^[a-z]{2,}$/.test(labels[labels.length - 1]);
}

/** "app.cancham.mg" → "app"; an apex domain → "@". */
export function subdomainOf(hostname: string): string {
  const labels = hostname.split(".");
  const suffixSize = TWO_LABEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(0, -suffixSize).join(".") || "@";
}

/** The records a user must create for a custom domain. */
export function dnsRecordsFor(
  hostname: string,
  cnameTarget: string,
  verificationToken: string,
  verified = false,
): DnsRecord[] {
  const sub = subdomainOf(hostname);
  return [
    { type: "CNAME", name: sub, value: cnameTarget, ttl: 3600, verified },
    {
      type: "TXT",
      name: sub === "@" ? "_mini-railway" : `_mini-railway.${sub}`,
      value: `mr-verify=${verificationToken}`,
      ttl: 3600,
      verified,
    },
  ];
}

export const CERTIFICATE_ISSUER = "Let's Encrypt";

export function issuedCertificate(now: number): Domain["ssl"] {
  return { status: "issued", issuer: CERTIFICATE_ISSUER, expiresAt: iso(now + 90 * DAY) };
}

/**
 * Recomputes `service.primaryDomain`: the oldest active custom domain, else
 * the oldest active generated one. Returns true when the value changed.
 */
export function syncPrimaryDomain(db: MockDb, serviceId: ID): boolean {
  const service = db.services.find((item) => item.id === serviceId);
  if (!service) return false;
  const active = db.domains
    .filter((domain) => domain.serviceId === serviceId && domain.status === "active")
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "custom" ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
  const next = active[0]?.hostname ?? null;
  if (service.primaryDomain === next) return false;
  service.primaryDomain = next;
  service.updatedAt = iso();
  return true;
}

/** "up.mini-railway.app" → "proxy.mini-railway.app" (TCP proxy of public databases). */
export function proxyDomain(baseDomain: string): string {
  const labels = baseDomain.split(".");
  return labels.length >= 3 ? ["proxy", ...labels.slice(1)].join(".") : `proxy.${baseDomain}`;
}
