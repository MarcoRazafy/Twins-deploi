import type { Domain, PlatformSettings } from "@/lib/types";

import { CERTIFICATE_ISSUER, dnsRecordsFor } from "../domain/domains";
import { hexString, seededRng } from "../generators/prng";
import { PRJ, SVC, type SeedClock } from "./clock";

interface DomainSeed {
  id: string;
  projectId: string;
  serviceId: string;
  hostname: string;
  kind: Domain["kind"];
  status: Domain["status"];
  targetPort: number;
  createdHoursAgo: number;
  /** Active domains: hours since the DNS check succeeded. */
  verifiedHoursAgo?: number;
  /** Active domains: days before the certificate expires. */
  certificateDaysLeft?: number;
}

const DOMAINS: DomainSeed[] = [
  {
    id: "dom_cancham_app",
    projectId: PRJ.cancham,
    serviceId: SVC.canchamApp,
    hostname: "app.cancham.mg",
    kind: "custom",
    status: "active",
    targetPort: 3000,
    createdHoursAgo: 408,
    verifiedHoursAgo: 384,
    certificateDaysLeft: 74,
  },
  {
    id: "dom_boutique_storefront",
    projectId: PRJ.boutique,
    serviceId: SVC.boutiqueStorefront,
    hostname: "boutique-vanille.mg",
    kind: "custom",
    status: "active",
    targetPort: 3000,
    createdHoursAgo: 1080,
    verifiedHoursAgo: 1077,
    certificateDaysLeft: 45,
  },
  {
    id: "dom_boutique_storefront_generated",
    projectId: PRJ.boutique,
    serviceId: SVC.boutiqueStorefront,
    hostname: "storefront-production-4f2a.up.mini-railway.app",
    kind: "generated",
    status: "active",
    targetPort: 3000,
    createdHoursAgo: 1103.5,
    verifiedHoursAgo: 1103.5,
    certificateDaysLeft: 44,
  },
  {
    id: "dom_boutique_api_generated",
    projectId: PRJ.boutique,
    serviceId: SVC.boutiqueApi,
    hostname: "api-production-7c1e.up.mini-railway.app",
    kind: "generated",
    status: "active",
    targetPort: 3000,
    createdHoursAgo: 1102.5,
    verifiedHoursAgo: 1102.5,
    certificateDaysLeft: 44,
  },
  {
    id: "dom_observatoire_metabase_generated",
    projectId: PRJ.observatoire,
    serviceId: SVC.observatoireMetabase,
    hostname: "metabase-production-b93d.up.mini-railway.app",
    kind: "generated",
    status: "active",
    targetPort: 3000,
    createdHoursAgo: 1701,
    verifiedHoursAgo: 1701,
    certificateDaysLeft: 19,
  },
  {
    id: "dom_portfolio_site",
    projectId: PRJ.portfolio,
    serviceId: SVC.portfolioSite,
    hostname: "marco-razafy.dev",
    kind: "custom",
    status: "pending_dns",
    targetPort: 4321,
    createdHoursAgo: 156,
  },
];

export function seedDomains(clock: SeedClock, settings: PlatformSettings): Domain[] {
  return DOMAINS.map((seed): Domain => {
    const active = seed.status === "active";
    return {
      id: seed.id,
      projectId: seed.projectId,
      serviceId: seed.serviceId,
      hostname: seed.hostname,
      kind: seed.kind,
      status: seed.status,
      targetPort: seed.targetPort,
      dnsRecords:
        seed.kind === "custom"
          ? dnsRecordsFor(
              seed.hostname,
              settings.dns.cnameTarget,
              hexString(seededRng("dns", seed.id), 24),
              active,
            )
          : [],
      ssl: active
        ? {
            status: "issued",
            issuer: CERTIFICATE_ISSUER,
            expiresAt: clock.inDays(seed.certificateDaysLeft ?? 60),
          }
        : { status: "none", issuer: null, expiresAt: null },
      forceHttps: settings.nginx.forceHttps,
      createdAt: clock.hoursAgo(seed.createdHoursAgo),
      verifiedAt: active ? clock.hoursAgo(seed.verifiedHoursAgo ?? seed.createdHoursAgo) : null,
      lastCheckedAt: active ? clock.hoursAgo(2.1) : null,
      error: null,
    };
  });
}
