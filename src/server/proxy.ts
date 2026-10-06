/**
 * The ONLY place that calls the privileged helpers (scripts/server/bin):
 * `mini-railway-proxy` (NGINX entries) and `mini-railway-hosts` (/etc/hosts),
 * both through `sudo -n`. They accept data only (a hostname and a loopback
 * port) and validate it again; this module validates first so that a bug
 * elsewhere cannot even reach them with garbage.
 *
 * Nothing here throws: every function resolves with a ProxyResult. Tenant
 * domains never use the helper's `--platform` flag (reserved for the platform's
 * own virtual host, written by setup.sh), so it is deliberately not exposed.
 *
 * Helper exit codes. proxy: 0 ok, 2 invalid input / reserved host, 3 nginx
 * rejected the configuration (rolled back), 4 written but nginx could not be
 * reloaded. hosts: 0 ok, 2 invalid input, 3 /etc/hosts in an unexpected state.
 */

import path from "node:path";

import { env } from "./env";
import { run, type RunResult } from "./exec";
import { getPlatformSettings } from "./platform-settings";
import { isFqdn, normalizeHostname } from "./rules";

export type ProxyFailure = "not_configured" | "rejected" | "failed";
export type ProxyResult =
  | { ok: true }
  | { ok: false; reason: ProxyFailure; message: string };

export interface PublishHostOptions {
  hostname: string;
  /** Loopback port published by the container (20000-29999). */
  port: number;
  /** Default: platform setting nginx.clientMaxBodySizeMb. */
  maxBodyMb?: number;
  /** Default: platform setting nginx.proxyReadTimeoutSec. */
  readTimeoutSec?: number;
  /** Default: platform setting nginx.gzip. */
  gzip?: boolean;
  /** Serve HTTPS with the Let's Encrypt certificate of the host (must exist). */
  tls?: boolean;
  /** With `tls`: answer HTTP with a redirect to HTTPS. */
  forceHttps?: boolean;
}

export const APP_PORT_RANGE = { min: 20_000, max: 29_999 } as const;

export const PROXY_NOT_CONFIGURED =
  "Le proxy NGINX n’est pas configuré sur cette machine : exécutez scripts/server/setup.sh pour installer les assistants, puis republiez le domaine.";
export const HOSTS_NOT_CONFIGURED =
  "L’assistant /etc/hosts n’est pas configuré sur cette machine : exécutez scripts/server/setup.sh pour l’installer, puis republiez le domaine.";

/** nginx -t and a reload can take a few seconds on a busy machine. */
const HELPER_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BODY_MB = 50;
const DEFAULT_READ_TIMEOUT_SEC = 60;

/** Names that /etc/hosts may carry (RFC 6761): the hosts helper refuses anything else. */
export function isLocalHostname(hostname: string): boolean {
  return hostname.endsWith(".test") || hostname.endsWith(".localhost");
}

function failure(reason: ProxyFailure, message: string): ProxyResult {
  return { ok: false, reason, message };
}

/** A helper path from the environment, only when absolute (it is passed to sudo as a command). */
function helperPath(value: string | null): string | null {
  return value !== null && path.isAbsolute(value) ? value : null;
}

function detailOf(result: RunResult): string {
  const text = result.stderr.trim() || result.stdout.trim();
  const flat = text.replace(/\s*\n\s*/g, " · ");
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

async function runHelper(
  helper: string,
  args: readonly string[],
  label: string,
  rejectedCodes: readonly number[],
): Promise<ProxyResult> {
  let result: RunResult;
  try {
    result = await run("sudo", ["-n", helper, ...args], { timeoutMs: HELPER_TIMEOUT_MS });
  } catch {
    return failure("failed", `Impossible de lancer ${label} : sudo est introuvable ou inutilisable.`);
  }
  if (result.timedOut) {
    return failure("failed", `${label} n’a pas répondu dans le délai imparti.`);
  }
  if (result.code === 0) return { ok: true };

  const detail = detailOf(result);
  const suffix = detail ? ` : ${detail}` : "";
  if (rejectedCodes.includes(result.code)) {
    return failure("rejected", `${label} a refusé la demande${suffix}`);
  }
  if (result.code === 4) {
    return failure("failed", `La configuration est écrite mais NGINX n’a pas pu être rechargé${suffix}`);
  }
  return failure("failed", `${label} a échoué (code ${result.code})${suffix}`);
}

async function proxyOptions(options: PublishHostOptions) {
  let settings: { maxBodyMb: number; readTimeoutSec: number; gzip: boolean } | null = null;
  const needsSettings =
    options.maxBodyMb === undefined || options.readTimeoutSec === undefined || options.gzip === undefined;
  if (needsSettings) {
    try {
      const { nginx } = await getPlatformSettings();
      settings = {
        maxBodyMb: nginx.clientMaxBodySizeMb,
        readTimeoutSec: nginx.proxyReadTimeoutSec,
        gzip: nginx.gzip,
      };
    } catch {
      // Settings unreadable: the helper's own defaults apply.
    }
  }
  const bounded = (value: number | undefined, fallback: number, max: number): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(1, Math.round(value))) : fallback;
  return {
    maxBodyMb: bounded(options.maxBodyMb ?? settings?.maxBodyMb, DEFAULT_MAX_BODY_MB, 10_240),
    readTimeoutSec: bounded(options.readTimeoutSec ?? settings?.readTimeoutSec, DEFAULT_READ_TIMEOUT_SEC, 3_600),
    gzip: options.gzip ?? settings?.gzip ?? true,
  };
}

/**
 * Makes `hostname` reach 127.0.0.1:`port`: /etc/hosts entry first for local
 * names, then the NGINX entry. Idempotent.
 */
export async function publishHost(options: PublishHostOptions): Promise<ProxyResult> {
  const hostname = normalizeHostname(options.hostname);
  if (!isFqdn(hostname)) {
    return failure("rejected", "Ce nom de domaine n’est pas valide.");
  }
  const { port } = options;
  if (!Number.isInteger(port) || port < APP_PORT_RANGE.min || port > APP_PORT_RANGE.max) {
    return failure(
      "rejected",
      `Le port ${String(port)} est hors de la plage réservée aux conteneurs (${APP_PORT_RANGE.min}-${APP_PORT_RANGE.max}).`,
    );
  }

  const proxy = helperPath(env.proxyHelper);
  if (proxy === null) return failure("not_configured", PROXY_NOT_CONFIGURED);
  const local = isLocalHostname(hostname);
  const hosts = local ? helperPath(env.hostsHelper) : null;
  if (local && hosts === null) return failure("not_configured", HOSTS_NOT_CONFIGURED);

  if (hosts !== null) {
    const added = await runHelper(hosts, ["add", hostname], "L’assistant /etc/hosts", [2]);
    if (!added.ok) return added;
  }

  const tuning = await proxyOptions(options);
  return runHelper(
    proxy,
    [
      "apply",
      "--host",
      hostname,
      "--port",
      String(port),
      "--max-body-mb",
      String(tuning.maxBodyMb),
      "--read-timeout",
      String(tuning.readTimeoutSec),
      ...(tuning.gzip ? ["--gzip"] : []),
      ...(options.tls ? ["--tls"] : []),
      ...(options.tls && options.forceHttps ? ["--force-https"] : []),
    ],
    "L’assistant du proxy",
    [2, 3],
  );
}

/** Removes the NGINX entry and, for local names, the /etc/hosts entry. Both are attempted. */
export async function unpublishHost(rawHostname: string): Promise<ProxyResult> {
  const hostname = normalizeHostname(rawHostname);
  if (!isFqdn(hostname)) {
    return failure("rejected", "Ce nom de domaine n’est pas valide.");
  }
  const proxy = helperPath(env.proxyHelper);
  if (proxy === null) return failure("not_configured", PROXY_NOT_CONFIGURED);

  const removed = await runHelper(proxy, ["remove", "--host", hostname], "L’assistant du proxy", [2, 3]);
  // Without the hosts helper no entry could have been added: nothing to remove.
  const hosts = isLocalHostname(hostname) ? helperPath(env.hostsHelper) : null;
  const cleaned =
    hosts === null
      ? ({ ok: true } satisfies ProxyResult)
      : await runHelper(hosts, ["remove", hostname], "L’assistant /etc/hosts", [2]);
  return removed.ok ? cleaned : removed;
}
