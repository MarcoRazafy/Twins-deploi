import { formatDate, pluralize, slugify } from "@/lib/format";
import type { Domain, DomainKind, DomainStatus } from "@/lib/types";

const DAY_MS = 86_400_000;

/** A certificate this close to its expiry gets the warning tone. */
export const SSL_WARNING_DAYS = 30;

export const DOMAIN_KIND_LABELS: Record<DomainKind, string> = {
  generated: "Généré",
  custom: "Personnalisé",
};

/** Order of the status filter; the labels come from `DOMAIN_STATUS`. */
export const DOMAIN_STATUSES = [
  "active",
  "pending_dns",
  "verifying",
  "issuing_certificate",
  "error",
] as const satisfies readonly DomainStatus[];

export function parseStatusFilter(value: string | null): DomainStatus | null {
  return DOMAIN_STATUSES.find((status) => status === value) ?? null;
}

/** DNS check or certificate issuance in flight: nothing to relaunch until it settles. */
export function isVerificationRunning(status: DomainStatus): boolean {
  return status === "verifying" || status === "issuing_certificate";
}

// ─────────────────────────────────────────────────────────────────────────────
// Certificates
// ─────────────────────────────────────────────────────────────────────────────

/** Milliseconds before the certificate expires; null without a certificate date or a clock. */
export function sslMsLeft(domain: Pick<Domain, "ssl">, now: number): number | null {
  const { status, expiresAt } = domain.ssl;
  if (status !== "issued" || !expiresAt || now <= 0) return null;
  return Date.parse(expiresAt) - now;
}

export function isSslExpiringSoon(domain: Pick<Domain, "ssl">, now: number): boolean {
  const left = sslMsLeft(domain, now);
  return left !== null && left < SSL_WARNING_DAYS * DAY_MS;
}

/** Tooltip text: "Expire dans 12 jours". */
export function formatSslCountdown(msLeft: number): string {
  if (msLeft <= 0) return "Certificat expiré";
  return `Expire dans ${pluralize(Math.ceil(msLeft / DAY_MS), "jour")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page figures
// ─────────────────────────────────────────────────────────────────────────────

export interface DomainStats {
  total: number;
  active: number;
  pendingDns: number;
  /** Verifying or issuing a certificate right now. */
  inProgress: number;
  validCertificates: number;
  expiringSoon: number;
}

export function computeDomainStats(domains: readonly Domain[], now: number): DomainStats {
  const stats: DomainStats = {
    total: domains.length,
    active: 0,
    pendingDns: 0,
    inProgress: 0,
    validCertificates: 0,
    expiringSoon: 0,
  };
  for (const domain of domains) {
    if (domain.status === "active") stats.active += 1;
    else if (domain.status === "pending_dns") stats.pendingDns += 1;
    else if (isVerificationRunning(domain.status)) stats.inProgress += 1;
    if (domain.ssl.status === "issued") stats.validCertificates += 1;
    if (isSslExpiringSoon(domain, now)) stats.expiringSoon += 1;
  }
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Form validation (mirrors the rules of the API so errors show before the round trip)
// ─────────────────────────────────────────────────────────────────────────────

const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const HOSTNAME_ERROR = "Saisissez un nom de domaine valide, par exemple app.exemple.mg.";
export const PORT_ERROR = "Le port doit être un entier compris entre 1 et 65535.";

/** Lower-cases and strips what people paste along with a hostname (scheme, path, final dot). */
export function normalizeHostname(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

/** Returns an error message, or null when `hostname` (already normalised) is a valid FQDN. */
export function validateHostname(hostname: string): string | null {
  if (!hostname) return "Saisissez un nom de domaine.";
  const labels = hostname.split(".");
  const valid =
    hostname.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => DNS_LABEL.test(label)) &&
    /^[a-z]{2,}$/.test(labels[labels.length - 1]);
  return valid ? null : HOSTNAME_ERROR;
}

/** An integer between 1 and 65535, or null. */
export function parsePort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return port >= 1 && port <= 65_535 ? port : null;
}

/** Address of a service on the private network of its project. */
export function internalAddress(serviceName: string, port: number): string {
  return `${slugify(serviceName)}.railway.internal:${port}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification stepper
// ─────────────────────────────────────────────────────────────────────────────

export type StepKey = "dns" | "ssl" | "live";
export type StepState = "done" | "active" | "waiting" | "failed" | "upcoming";

export interface DomainStep {
  key: StepKey;
  label: string;
  description: string;
  state: StepState;
}

export const STEP_STATE_LABELS: Record<StepState, string> = {
  done: "Terminé",
  active: "En cours",
  waiting: "En attente",
  failed: "Échec",
  upcoming: "À venir",
};

/** Maps the backend status onto the three steps shown to the user. */
export function deriveDomainSteps(domain: Domain): DomainStep[] {
  const generated = domain.kind === "generated";
  const expiry = domain.ssl.expiresAt ? formatDate(domain.ssl.expiresAt) : null;

  const dnsDone = generated
    ? "Géré par la plateforme : aucun enregistrement à créer."
    : "Les enregistrements DNS sont en place.";
  const sslDone = expiry ? `Certificat valide jusqu’au ${expiry}.` : "Certificat valide.";
  const sslIdle = "Émis automatiquement par Let’s Encrypt une fois le DNS validé.";
  const liveIdle = "Le domaine sert votre service en HTTPS.";

  const dns = (state: StepState, description: string): DomainStep => ({
    key: "dns",
    label: "Configuration DNS",
    description,
    state,
  });
  const ssl = (state: StepState, description: string): DomainStep => ({
    key: "ssl",
    label: "Certificat SSL",
    description,
    state,
  });
  const live = (state: StepState, description: string): DomainStep => ({
    key: "live",
    label: "Domaine actif",
    description,
    state,
  });

  switch (domain.status) {
    case "pending_dns":
      return [
        dns("waiting", "Créez les enregistrements ci-dessous chez votre registrar, puis lancez la vérification."),
        ssl("upcoming", sslIdle),
        live("upcoming", liveIdle),
      ];
    case "verifying":
      return [
        dns("active", "Résolution des enregistrements DNS en cours…"),
        ssl("upcoming", sslIdle),
        live("upcoming", liveIdle),
      ];
    case "issuing_certificate":
      return [
        dns("done", dnsDone),
        ssl("active", "Émission du certificat en cours…"),
        live("upcoming", liveIdle),
      ];
    case "active":
      return [
        dns("done", domain.dnsRecords.length === 0 ? "Aucun enregistrement à créer pour ce domaine." : dnsDone),
        // Local domains (.test, .localhost) are served over plain HTTP: no certificate step.
        ...(domain.ssl.status === "issued" ? [ssl("done", sslDone)] : []),
        live(
          "done",
          domain.ssl.status === "issued"
            ? "Le domaine est en ligne et sert votre service."
            : "Le domaine est en ligne et sert votre service en HTTP, sans certificat.",
        ),
      ];
    case "error":
      return domain.ssl.status === "error"
        ? [
            dns("done", dnsDone),
            ssl("failed", "L’émission du certificat a échoué."),
            live("upcoming", liveIdle),
          ]
        : [
            dns("failed", "La vérification des enregistrements DNS a échoué."),
            ssl("upcoming", sslIdle),
            live("upcoming", liveIdle),
          ];
  }
}
