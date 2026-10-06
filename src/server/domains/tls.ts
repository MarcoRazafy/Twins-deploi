/**
 * HTTPS for public domains: Let's Encrypt certificates through the privileged
 * helper mini-railway-cert (scripts/server/bin), the only process that runs
 * certbot. Like the proxy helper it is called with `sudo -n` and accepts data
 * only (a hostname, an e-mail address).
 *
 * A certificate is requested after a public domain is published over HTTP
 * (the HTTP-01 challenge is answered on port 80 by every vhost), then the
 * vhost is rewritten with TLS. Local names (.test, .localhost) and machines
 * without the helper keep plain HTTP: `tlsEligible` says which.
 */

import { env } from "../env";
import { run, type RunResult } from "../exec";
import { isLocalHostname } from "../proxy";

export interface CertificateInfo {
  issuer: string | null;
  expiresAt: Date | null;
}

export type CertFailure = "not_configured" | "rejected" | "failed";
export type CertResult<T> = { ok: true; value: T } | { ok: false; reason: CertFailure; message: string };

export const CERT_NOT_CONFIGURED =
  "HTTPS n’est pas configuré sur cette machine : exécutez scripts/server/setup.sh (il installe certbot et l’assistant mini-railway-cert), puis relancez la vérification du domaine.";

const HELPER_TIMEOUT_MS = 240_000;

function helperPath(): string | null {
  const value = env.certHelper;
  return value !== null && value.startsWith("/") ? value : null;
}

/** True when the platform may obtain a certificate for `hostname` here. */
export function tlsEligible(hostname: string): boolean {
  return helperPath() !== null && !isLocalHostname(hostname.toLowerCase());
}

function detailOf(result: RunResult): string {
  const text = (result.stderr.trim() || result.stdout.trim()).replace(/^mini-railway-cert: /, "");
  const flat = text.replace(/\s*\n\s*/g, " · ");
  return flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
}

async function runHelper(args: readonly string[]): Promise<CertResult<Record<string, unknown>>> {
  const helper = helperPath();
  if (helper === null) return { ok: false, reason: "not_configured", message: CERT_NOT_CONFIGURED };
  let result: RunResult;
  try {
    result = await run("sudo", ["-n", helper, ...args], { timeoutMs: HELPER_TIMEOUT_MS });
  } catch {
    return { ok: false, reason: "failed", message: "Impossible de lancer l’assistant des certificats : sudo est introuvable ou inutilisable." };
  }
  if (result.timedOut) {
    return { ok: false, reason: "failed", message: "L’assistant des certificats n’a pas répondu dans le délai imparti." };
  }
  if (result.code !== 0) {
    const detail = detailOf(result);
    const suffix = detail ? ` : ${detail}` : "";
    if (result.code === 2) return { ok: false, reason: "rejected", message: `L’assistant des certificats a refusé la demande${suffix}` };
    if (result.code === 5) return { ok: false, reason: "not_configured", message: `certbot n’est pas installé sur cette machine (apt-get install certbot)${suffix}` };
    return { ok: false, reason: "failed", message: `Let’s Encrypt n’a pas délivré le certificat${suffix}` };
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (typeof parsed === "object" && parsed !== null) return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    // fall through
  }
  return { ok: false, reason: "failed", message: "L’assistant des certificats a renvoyé une réponse illisible." };
}

function toInfo(record: Record<string, unknown>): CertificateInfo {
  const issuer = typeof record.issuer === "string" && record.issuer !== "" ? record.issuer : null;
  const raw = typeof record.expiresAt === "string" ? new Date(record.expiresAt) : null;
  return { issuer, expiresAt: raw !== null && !Number.isNaN(raw.getTime()) ? raw : null };
}

/** The certificate currently installed for `hostname`, null when there is none. */
export async function certificateStatus(hostname: string): Promise<CertResult<CertificateInfo | null>> {
  const result = await runHelper(["status", "--host", hostname]);
  if (!result.ok) return result;
  return { ok: true, value: result.value.exists === true ? toInfo(result.value) : null };
}

/** Obtains (or keeps, when still valid) the certificate of `hostname`. Slow: up to a few minutes. */
export async function issueCertificate(hostname: string): Promise<CertResult<CertificateInfo>> {
  const email = env.acmeEmail;
  const result = await runHelper(["issue", "--host", hostname, ...(email ? ["--email", email] : [])]);
  if (!result.ok) return result;
  return { ok: true, value: toInfo(result.value) };
}

export interface RenewedCertificate extends CertificateInfo {
  host: string;
}

/** `certbot renew` for every certificate; resolves with what is installed afterwards. */
export async function renewCertificates(): Promise<CertResult<RenewedCertificate[]>> {
  const result = await runHelper(["renew"]);
  if (!result.ok) return result;
  const list = Array.isArray(result.value.certificates) ? result.value.certificates : [];
  const renewed: RenewedCertificate[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.host !== "string") continue;
    renewed.push({ host: record.host, ...toInfo(record) });
  }
  return { ok: true, value: renewed };
}

/** Deletes the certificate of a removed domain (best effort). */
export async function removeCertificate(hostname: string): Promise<CertResult<boolean>> {
  const result = await runHelper(["remove", "--host", hostname]);
  if (!result.ok) return result;
  return { ok: true, value: result.value.changed === true };
}

/** A certificate that expires within 24 h is treated as absent: it must not be served. */
export function certificateUsable(info: CertificateInfo | null, now = Date.now()): info is CertificateInfo {
  return info !== null && info.expiresAt !== null && info.expiresAt.getTime() - now > 24 * 60 * 60 * 1000;
}
