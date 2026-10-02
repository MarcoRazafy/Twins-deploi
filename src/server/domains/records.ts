import type { DnsRecord, PlatformSettings } from "@/lib/types";

/** Public suffixes made of two labels, so "shop.co.mg" is an apex and not a subdomain. */
const TWO_LABEL_SUFFIXES = new Set([
  "co.mg", "com.mg", "org.mg", "gov.mg", "edu.mg", "nom.mg", "prd.mg", "tm.mg",
  "co.uk", "org.uk", "com.au", "co.za", "com.br", "co.jp", "co.nz", "com.fr",
]);

const RECORD_TTL = 3600;

/** "app.cancham.mg" → "app"; an apex domain → "@". */
export function subdomainOf(hostname: string): string {
  const labels = hostname.split(".");
  const suffixSize = TWO_LABEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(0, -suffixSize).join(".") || "@";
}

/**
 * The record a user must create for a public domain: a CNAME to the platform
 * for a subdomain, an A record to the server for an apex name (a CNAME cannot
 * live at the apex).
 */
export function dnsRecordsFor(hostname: string, dns: PlatformSettings["dns"]): DnsRecord[] {
  const name = subdomainOf(hostname);
  if (name === "@") {
    return [{ type: "A", name, value: dns.serverIp, ttl: RECORD_TTL, verified: false }];
  }
  return [{ type: "CNAME", name, value: dns.cnameTarget, ttl: RECORD_TTL, verified: false }];
}
