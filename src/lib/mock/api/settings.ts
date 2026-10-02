import { avatarProblem } from "@/lib/avatar";
import { ENTITIES, type Api, type DeepPartial } from "@/lib/api/contract";
import {
  REGIONS,
  type ApiToken,
  type MemberRole,
  type PlatformSettings,
  type TeamMember,
} from "@/lib/types";

import { resetDb } from "../db";
import { addActivity } from "../domain/activity";
import { refreshUrls } from "../domain/databases";
import { isFqdn } from "../domain/domains";
import { emit } from "../emitter";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { newId, randomHex } from "../ids";
import { latency } from "../latency";
import type { MockDb } from "../schema";
import { stopSimulations } from "../simulator";
import { DAY, iso, newestFirst, sameName } from "../text";
import { read, write } from "./respond";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ASSIGNABLE_ROLES: MemberRole[] = ["admin", "developer", "viewer"];

/** Drops the keys a partial patch leaves undefined, so a spread cannot erase values. */
function defined<T extends object>(patch: T | undefined): Partial<T> {
  const result: Partial<T> = {};
  if (!patch) return result;
  for (const key of Object.keys(patch) as Array<keyof T>) {
    if (patch[key] !== undefined) result[key] = patch[key];
  }
  return result;
}

function merge(current: PlatformSettings, patch: DeepPartial<PlatformSettings>): PlatformSettings {
  return {
    workspaceName: patch.workspaceName ?? current.workspaceName,
    baseDomain: patch.baseDomain ?? current.baseDomain,
    defaultRegion: patch.defaultRegion ?? current.defaultRegion,
    deployments: { ...current.deployments, ...defined(patch.deployments) },
    docker: { ...current.docker, ...defined(patch.docker) },
    nginx: { ...current.nginx, ...defined(patch.nginx) },
    dns: { ...current.dns, ...defined(patch.dns) },
    notifications: { ...current.notifications, ...defined(patch.notifications) },
  };
}

function within(value: number, min: number, max: number, integer = true): boolean {
  return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}

/** Field names are dotted paths into the settings object ("dns.serverIp"). */
function validate(settings: PlatformSettings): PlatformSettings {
  const workspaceName = settings.workspaceName.trim();
  if (workspaceName.length < 2 || workspaceName.length > 40) {
    throw invalid("Le nom de l’espace de travail doit contenir entre 2 et 40 caractères.", "workspaceName");
  }
  const baseDomain = settings.baseDomain.trim().toLowerCase();
  if (!isFqdn(baseDomain)) {
    throw invalid("Saisissez un domaine valide, par exemple up.exemple.mg.", "baseDomain");
  }
  if (!REGIONS.includes(settings.defaultRegion)) {
    throw invalid("Cette région n’est pas disponible.", "defaultRegion");
  }

  const { deployments, docker, nginx, dns } = settings;
  if (!within(deployments.buildTimeoutMin, 1, 120)) {
    throw invalid("Le délai de build doit être compris entre 1 et 120 minutes.", "deployments.buildTimeoutMin");
  }
  if (!within(deployments.retention, 1, 100)) {
    throw invalid("Le nombre de déploiements conservés doit être compris entre 1 et 100.", "deployments.retention");
  }
  if (deployments.defaultBuilder !== "nixpacks" && deployments.defaultBuilder !== "dockerfile") {
    throw invalid("Ce mode de build n’est pas disponible.", "deployments.defaultBuilder");
  }

  const socketPath = docker.socketPath.trim();
  if (!socketPath.startsWith("/")) {
    throw invalid("Le chemin du socket Docker doit être absolu.", "docker.socketPath");
  }
  const registryUrl = docker.registryUrl.trim();
  if (!/^https?:\/\/[^\s/]+/.test(registryUrl)) {
    throw invalid("Saisissez l’URL du registre, par exemple https://registry.exemple.mg.", "docker.registryUrl");
  }
  if (!within(docker.defaultCpuLimit, 0.25, 8, false)) {
    throw invalid("La limite de CPU doit être comprise entre 0,25 et 8 vCPU.", "docker.defaultCpuLimit");
  }
  if (!within(docker.defaultMemoryLimitMb, 128, 16_384)) {
    throw invalid("La limite de mémoire doit être comprise entre 128 et 16 384 Mo.", "docker.defaultMemoryLimitMb");
  }

  if (!within(nginx.clientMaxBodySizeMb, 1, 1024)) {
    throw invalid("La taille maximale des requêtes doit être comprise entre 1 et 1024 Mo.", "nginx.clientMaxBodySizeMb");
  }
  if (!within(nginx.proxyReadTimeoutSec, 1, 3600)) {
    throw invalid("Le délai de lecture doit être compris entre 1 et 3600 secondes.", "nginx.proxyReadTimeoutSec");
  }

  if (dns.provider !== "manual" && dns.provider !== "cloudflare") {
    throw invalid("Ce fournisseur DNS n’est pas disponible.", "dns.provider");
  }
  const serverIp = dns.serverIp.trim();
  if (!IPV4_PATTERN.test(serverIp)) {
    throw invalid("Saisissez une adresse IPv4 valide, par exemple 102.16.44.10.", "dns.serverIp");
  }
  const cnameTarget = dns.cnameTarget.trim().toLowerCase();
  if (!isFqdn(cnameTarget)) {
    throw invalid("Saisissez un nom d’hôte valide, par exemple ingress.exemple.mg.", "dns.cnameTarget");
  }

  return {
    ...settings,
    workspaceName,
    baseDomain,
    docker: { ...docker, socketPath, registryUrl },
    dns: { ...dns, serverIp, cnameTarget },
  };
}

function validEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw invalid("Saisissez une adresse e-mail valide.", "email");
  }
  return email;
}

/** "hery.rakoto@exemple.mg" → "Hery Rakoto" */
function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function requireMember(db: MockDb, id: string): TeamMember {
  const member = db.members.find((item) => item.id === id);
  if (!member) throw notFound("Membre");
  return member;
}

function assertAssignable(role: MemberRole): void {
  if (role === "owner") {
    throw forbidden("Le rôle de propriétaire ne peut pas être attribué.");
  }
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw invalid("Ce rôle n’existe pas.", "role");
  }
}

export const settingsApi: Api["settings"] = {
  get: () => read((db) => db.settings),

  update: (patch) =>
    write((db) => {
      const next = validate(merge(db.settings, patch));
      const domainChanged = next.baseDomain !== db.settings.baseDomain;
      db.settings = next;
      // Public database URLs live under a domain derived from the base domain.
      if (domainChanged) {
        for (const database of db.databases) refreshUrls(database, next.baseDomain);
      }
      addActivity(db, {
        type: "settings.updated",
        title: "Réglages de la plateforme modifiés",
        description: next.workspaceName,
      });
      emit(domainChanged ? ["settings", "databases", "activity"] : ["settings", "activity"]);
      return db.settings;
    }),

  getProfile: () => read((db) => db.profile),

  updateProfile: (patch) =>
    write((db) => {
      const name = patch.name !== undefined ? patch.name.trim() : db.profile.name;
      if (name.length < 2 || name.length > 60) {
        throw invalid("Le nom doit contenir entre 2 et 60 caractères.", "name");
      }
      const email = patch.email !== undefined ? validEmail(patch.email) : db.profile.email;
      if (db.members.some((member) => member.id !== db.profile.id && member.email === email)) {
        throw conflict("Cette adresse e-mail est déjà utilisée par un membre.", "email");
      }
      let avatarUrl = db.profile.avatarUrl ?? null;
      if (patch.avatarUrl !== undefined) {
        if (patch.avatarUrl !== null) {
          const problem = avatarProblem(patch.avatarUrl);
          if (problem) throw invalid(problem, "avatarUrl");
        }
        avatarUrl = patch.avatarUrl;
      }
      db.profile = { ...db.profile, name, email, avatarUrl };
      const self = db.members.find((member) => member.id === db.profile.id);
      if (self) {
        self.name = name;
        self.email = email;
        self.avatarUrl = avatarUrl;
      }
      emit(["settings"]);
      return db.profile;
    }),

  listTokens: () => read((db) => newestFirst(db.tokens)),

  createToken: (input) =>
    write((db) => {
      const name = (input.name ?? "").trim();
      if (name.length < 2 || name.length > 40) {
        throw invalid("Le nom du jeton doit contenir entre 2 et 40 caractères.", "name");
      }
      if (db.tokens.some((token) => sameName(token.name, name))) {
        throw conflict("Un jeton porte déjà ce nom.", "name");
      }
      const expiresInDays = input.expiresInDays ?? null;
      if (expiresInDays !== null && !within(expiresInDays, 1, 365)) {
        throw invalid("La durée de validité doit être comprise entre 1 et 365 jours.", "expiresInDays");
      }

      const now = Date.now();
      const secret = `mr_live_${randomHex(32)}`;
      const token: ApiToken = {
        id: newId("tok"),
        name,
        // Only the first characters are kept: the secret itself is shown once.
        prefix: secret.slice(0, 12),
        createdAt: iso(now),
        lastUsedAt: null,
        expiresAt: expiresInDays === null ? null : iso(now + expiresInDays * DAY),
      };
      db.tokens.unshift(token);
      addActivity(db, { type: "settings.updated", title: "Jeton d’API créé", description: name });
      emit(["settings", "activity"]);
      return { token, secret };
    }),

  revokeToken: (id) =>
    write((db) => {
      const token = db.tokens.find((item) => item.id === id);
      if (!token) throw notFound("Jeton");
      db.tokens = db.tokens.filter((item) => item.id !== id);
      addActivity(db, {
        type: "settings.updated",
        severity: "warning",
        title: "Jeton d’API révoqué",
        description: token.name,
      });
      emit(["settings", "activity"]);
    }),

  // The owner first, then the most recent members.
  listMembers: () =>
    read((db) =>
      [...db.members].sort((a, b) => {
        if ((a.role === "owner") !== (b.role === "owner")) return a.role === "owner" ? -1 : 1;
        return a.joinedAt < b.joinedAt ? 1 : a.joinedAt > b.joinedAt ? -1 : 0;
      }),
    ),

  inviteMember: (input) =>
    write((db) => {
      const email = validEmail(input.email ?? "");
      assertAssignable(input.role);
      if (db.members.some((member) => member.email === email)) {
        throw conflict("Ce membre fait déjà partie de l’espace de travail.", "email");
      }
      const member: TeamMember = {
        id: newId("usr"),
        name: nameFromEmail(email),
        email,
        role: input.role,
        avatarUrl: null,
        status: "invited",
        joinedAt: iso(),
      };
      db.members.unshift(member);
      addActivity(db, { type: "settings.updated", title: "Membre invité", description: email });
      emit(["settings", "activity"]);
      return member;
    }),

  updateMember: (id, patch) =>
    write((db) => {
      const member = requireMember(db, id);
      if (member.role === "owner") {
        throw forbidden("Le rôle du propriétaire ne peut pas être modifié.");
      }
      assertAssignable(patch.role);
      member.role = patch.role;
      emit(["settings"]);
      return member;
    }),

  removeMember: (id) =>
    write((db) => {
      const member = requireMember(db, id);
      if (member.role === "owner") {
        throw forbidden("Le propriétaire ne peut pas être retiré de l’espace de travail.");
      }
      db.members = db.members.filter((item) => item.id !== id);
      addActivity(db, {
        type: "settings.updated",
        severity: "warning",
        title: "Membre retiré",
        description: member.email,
      });
      emit(["settings", "activity"]);
    }),

  resetDemoData: async () => {
    await latency.write();
    stopSimulations();
    // Re-seeds, then restarts the in-flight simulations of the fresh dataset.
    resetDb();
    emit([...ENTITIES]);
  },
};
