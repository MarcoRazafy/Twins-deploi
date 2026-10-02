/** DNS verification: verifying → issuing_certificate → active (or error). */

import type { EntityName } from "@/lib/api/contract";
import type { Domain, ID } from "@/lib/types";

import { getDb, save } from "../db";
import { addActivity, SYSTEM_ACTOR } from "../domain/activity";
import { issuedCertificate, syncPrimaryDomain } from "../domain/domains";
import { emit } from "../emitter";
import type { MockDb } from "../schema";
import { iso } from "../text";
import { after, timerKey } from "../timers";

const DNS_CHECK_MS = 2500;
const CERTIFICATE_MS = 3000;

function links(domain: Domain) {
  return { projectId: domain.projectId, serviceId: domain.serviceId };
}

function issueCertificate(domainId: ID): void {
  const db = getDb();
  const domain = db.domains.find((item) => item.id === domainId);
  if (!domain || domain.status !== "issuing_certificate") return;

  const now = Date.now();
  domain.status = "active";
  domain.ssl = issuedCertificate(now);
  domain.verifiedAt = iso(now);
  domain.lastCheckedAt = iso(now);
  domain.error = null;

  const entities: EntityName[] = ["domains", "activity"];
  if (syncPrimaryDomain(db, domain.serviceId)) entities.push("services", "projects");
  addActivity(db, {
    type: "domain.verified",
    severity: "success",
    title: "Domaine vérifié",
    description: `${domain.hostname} · certificat SSL émis`,
    ...links(domain),
    actor: SYSTEM_ACTOR,
    notify: true,
  });

  save();
  emit(entities, links(domain));
}

function checkDns(domainId: ID): void {
  const db = getDb();
  const domain = db.domains.find((item) => item.id === domainId);
  if (!domain || domain.status !== "verifying") return;

  domain.lastCheckedAt = iso();
  // Reserved TLD used to demo the failure path.
  if (domain.hostname.endsWith(".invalid")) {
    domain.status = "error";
    domain.error = `Enregistrement CNAME introuvable pour ${domain.hostname}`;
    save();
    emit(["domains"], links(domain));
    return;
  }

  domain.status = "issuing_certificate";
  domain.dnsRecords = domain.dnsRecords.map((record) => ({ ...record, verified: true }));
  domain.ssl = { status: "pending", issuer: null, expiresAt: null };
  save();
  emit(["domains"], links(domain));
  after(timerKey.domain(domainId), CERTIFICATE_MS, () => issueCertificate(domainId));
}

/** Marks the domain as `verifying`; the next steps happen on their own. */
export function beginVerification(domain: Domain): void {
  domain.status = "verifying";
  domain.error = null;
  domain.lastCheckedAt = iso();
  after(timerKey.domain(domain.id), DNS_CHECK_MS, () => checkDns(domain.id));
}

export function resumeDomains(db: MockDb): void {
  for (const domain of db.domains) {
    if (domain.status === "verifying") {
      after(timerKey.domain(domain.id), DNS_CHECK_MS, () => checkDns(domain.id));
    } else if (domain.status === "issuing_certificate") {
      after(timerKey.domain(domain.id), CERTIFICATE_MS, () => issueCertificate(domain.id));
    }
  }
}
