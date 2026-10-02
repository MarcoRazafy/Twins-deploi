import type { Api, EntityName } from "@/lib/api/contract";
import type { Domain, Service } from "@/lib/types";

import { addActivity } from "../domain/activity";
import {
  dnsRecordsFor,
  isFqdn,
  issuedCertificate,
  syncPrimaryDomain,
} from "../domain/domains";
import { emit } from "../emitter";
import { conflict, invalid } from "../errors";
import { newId, randomHex } from "../ids";
import { requireDomain, requireService } from "../lookup";
import { beginVerification } from "../simulator/domains";
import { iso, newestFirst, slugify } from "../text";
import { cancelTimer, timerKey } from "../timers";
import { read, write } from "./respond";

function links(domain: Pick<Domain, "projectId" | "serviceId">) {
  return { projectId: domain.projectId, serviceId: domain.serviceId };
}

function assertExposable(service: Service): void {
  if (service.source.type === "postgres") {
    throw invalid(
      "Les bases de données ne sont pas exposées en HTTP : utilisez leur URL de connexion.",
      "serviceId",
    );
  }
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw invalid("Le port cible doit être compris entre 1 et 65535.", "targetPort");
  }
}

export const domainsApi: Api["domains"] = {
  list: (filter = {}) =>
    read((db) =>
      newestFirst(
        db.domains.filter(
          (domain) =>
            (filter.projectId === undefined || domain.projectId === filter.projectId) &&
            (filter.serviceId === undefined || domain.serviceId === filter.serviceId),
        ),
      ),
    ),

  create: (input) =>
    write((db) => {
      const service = requireService(db, input.serviceId);
      assertExposable(service);

      const hostname = (input.hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
      if (!isFqdn(hostname)) {
        throw invalid(
          "Saisissez un nom de domaine valide, par exemple app.exemple.mg.",
          "hostname",
        );
      }
      const baseDomain = db.settings.baseDomain;
      if (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)) {
        throw invalid(
          `Les sous-domaines de ${baseDomain} sont réservés aux domaines générés.`,
          "hostname",
        );
      }
      if (db.domains.some((domain) => domain.hostname === hostname)) {
        throw conflict("Ce domaine est déjà utilisé par un service.", "hostname");
      }
      const targetPort = input.targetPort ?? service.config.port;
      assertPort(targetPort);

      const domain: Domain = {
        id: newId("dom"),
        projectId: service.projectId,
        serviceId: service.id,
        hostname,
        kind: "custom",
        status: "pending_dns",
        targetPort,
        dnsRecords: dnsRecordsFor(hostname, db.settings.dns.cnameTarget, randomHex(24)),
        ssl: { status: "none", issuer: null, expiresAt: null },
        forceHttps: db.settings.nginx.forceHttps,
        createdAt: iso(),
        verifiedAt: null,
        lastCheckedAt: null,
        error: null,
      };
      db.domains.unshift(domain);

      addActivity(db, {
        type: "domain.added",
        title: "Domaine ajouté",
        description: `${hostname} · ${service.name}`,
        ...links(domain),
      });
      emit(["domains", "projects", "activity"], links(domain));
      return domain;
    }),

  generate: (serviceId) =>
    write((db) => {
      const service = requireService(db, serviceId);
      assertExposable(service);

      const taken = new Set(db.domains.map((item) => item.hostname));
      const candidate = () =>
        `${slugify(service.name)}-production-${randomHex(4)}.${db.settings.baseDomain}`;
      let hostname = candidate();
      while (taken.has(hostname)) hostname = candidate();

      const now = Date.now();
      const domain: Domain = {
        id: newId("dom"),
        projectId: service.projectId,
        serviceId: service.id,
        hostname,
        kind: "generated",
        status: "active",
        targetPort: service.config.port,
        dnsRecords: [],
        ssl: issuedCertificate(now),
        forceHttps: db.settings.nginx.forceHttps,
        createdAt: iso(now),
        verifiedAt: iso(now),
        lastCheckedAt: iso(now),
        error: null,
      };
      db.domains.unshift(domain);

      const entities: EntityName[] = ["domains", "projects", "activity"];
      if (syncPrimaryDomain(db, service.id)) entities.push("services");
      addActivity(db, {
        type: "domain.added",
        title: "Domaine généré",
        description: `${hostname} · ${service.name}`,
        ...links(domain),
      });
      emit(entities, links(domain));
      return domain;
    }),

  update: (id, patch) =>
    write((db) => {
      const domain = requireDomain(db, id);
      if (patch.targetPort !== undefined) {
        assertPort(patch.targetPort);
        domain.targetPort = patch.targetPort;
      }
      if (patch.forceHttps !== undefined) domain.forceHttps = patch.forceHttps;
      emit(["domains"], links(domain));
      return domain;
    }),

  verify: (id) =>
    write((db) => {
      const domain = requireDomain(db, id);
      // A check already running keeps going; an active domain is simply re-checked.
      if (domain.status === "verifying" || domain.status === "issuing_certificate") return domain;
      if (domain.status === "active") {
        domain.lastCheckedAt = iso();
      } else {
        beginVerification(domain);
      }
      emit(["domains"], links(domain));
      return domain;
    }),

  delete: (id) =>
    write((db) => {
      const domain = requireDomain(db, id);
      cancelTimer(timerKey.domain(id));
      db.domains = db.domains.filter((item) => item.id !== id);

      const entities: EntityName[] = ["domains", "projects", "activity"];
      if (syncPrimaryDomain(db, domain.serviceId)) entities.push("services");
      addActivity(db, {
        type: "domain.removed",
        severity: "warning",
        title: "Domaine supprimé",
        description: domain.hostname,
        ...links(domain),
      });
      emit(entities, links(domain));
    }),
};
