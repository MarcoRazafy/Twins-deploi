import type { Api, DeepPartial } from "@/lib/api/contract";
import { REGIONS, type MemberRole, type PlatformSettings } from "@/lib/types";

import { recordActivity } from "../activity";
import { generateApiToken } from "../auth";
import { requireUser, type Context } from "../context";
import { db } from "../db";
import { conflict, forbidden, isUniqueViolation, notFound, validation } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { overlay } from "../mappers/settings";
import { toApiToken } from "../mappers/token";
import { toTeamMember, toUserProfile } from "../mappers/user";
import { getPlatformSettings, savePlatformSettings } from "../platform-settings";
import {
  asRecord,
  asString,
  CONFIG_LIMITS,
  inRange,
  IPV4_PATTERN,
  isFqdn,
  sameName,
  validEmail,
  validPersonName,
} from "../rules";

const DAY_MS = 24 * 60 * 60 * 1000;
const ASSIGNABLE_ROLES: readonly MemberRole[] = ["admin", "developer", "viewer"];

/** Field names are dotted paths into the settings object ("dns.serverIp"). */
function validate(settings: PlatformSettings): PlatformSettings {
  const workspaceName = settings.workspaceName.trim();
  if (workspaceName.length < 2 || workspaceName.length > 40) {
    throw validation("Le nom de l’espace de travail doit contenir entre 2 et 40 caractères.", "workspaceName");
  }
  const baseDomain = settings.baseDomain.trim().toLowerCase();
  if (!isFqdn(baseDomain)) {
    throw validation("Saisissez un domaine valide, par exemple up.exemple.mg.", "baseDomain");
  }
  if (!REGIONS.includes(settings.defaultRegion)) {
    throw validation("Cette région n’est pas disponible.", "defaultRegion");
  }

  const { deployments, docker, nginx, dns } = settings;
  if (!inRange(deployments.buildTimeoutMin, 1, 120)) {
    throw validation("Le délai de build doit être compris entre 1 et 120 minutes.", "deployments.buildTimeoutMin");
  }
  if (!inRange(deployments.retention, 1, 100)) {
    throw validation("Le nombre de déploiements conservés doit être compris entre 1 et 100.", "deployments.retention");
  }
  if (deployments.defaultBuilder !== "nixpacks" && deployments.defaultBuilder !== "dockerfile") {
    throw validation("Ce mode de build n’est pas disponible.", "deployments.defaultBuilder");
  }

  const socketPath = docker.socketPath.trim();
  if (!socketPath.startsWith("/")) {
    throw validation("Le chemin du socket Docker doit être absolu.", "docker.socketPath");
  }
  const registryUrl = docker.registryUrl.trim();
  if (!/^https?:\/\/[^\s/]+/.test(registryUrl)) {
    throw validation("Saisissez l’URL du registre, par exemple https://registry.exemple.mg.", "docker.registryUrl");
  }
  const { cpuLimit, memoryLimitMb } = CONFIG_LIMITS;
  if (!inRange(docker.defaultCpuLimit, cpuLimit.min, cpuLimit.max, false)) {
    throw validation("La limite de CPU doit être comprise entre 0,25 et 8 vCPU.", "docker.defaultCpuLimit");
  }
  if (!inRange(docker.defaultMemoryLimitMb, memoryLimitMb.min, memoryLimitMb.max)) {
    throw validation("La limite de mémoire doit être comprise entre 128 et 16 384 Mo.", "docker.defaultMemoryLimitMb");
  }

  if (!inRange(nginx.clientMaxBodySizeMb, 1, 1024)) {
    throw validation("La taille maximale des requêtes doit être comprise entre 1 et 1024 Mo.", "nginx.clientMaxBodySizeMb");
  }
  if (!inRange(nginx.proxyReadTimeoutSec, 1, 3600)) {
    throw validation("Le délai de lecture doit être compris entre 1 et 3600 secondes.", "nginx.proxyReadTimeoutSec");
  }

  if (dns.provider !== "manual" && dns.provider !== "cloudflare") {
    throw validation("Ce fournisseur DNS n’est pas disponible.", "dns.provider");
  }
  const serverIp = dns.serverIp.trim();
  if (!IPV4_PATTERN.test(serverIp)) {
    throw validation("Saisissez une adresse IPv4 valide, par exemple 102.16.44.10.", "dns.serverIp");
  }
  const cnameTarget = dns.cnameTarget.trim().toLowerCase();
  if (!isFqdn(cnameTarget)) {
    throw validation("Saisissez un nom d’hôte valide, par exemple ingress.exemple.mg.", "dns.cnameTarget");
  }

  return {
    ...settings,
    workspaceName,
    baseDomain,
    docker: { ...docker, socketPath, registryUrl },
    dns: { ...dns, serverIp, cnameTarget },
  };
}

/** "hery.rakoto@exemple.mg" → "Hery Rakoto" */
function nameFromEmail(email: string): string {
  const name = email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return name || email;
}

function assertAssignable(role: unknown): asserts role is MemberRole {
  if (role === "owner") {
    throw forbidden("Le rôle de propriétaire ne peut pas être attribué.");
  }
  if (!(ASSIGNABLE_ROLES as readonly unknown[]).includes(role)) {
    throw validation("Ce rôle n’existe pas.", "role");
  }
}

export function createSettingsApi(ctx: Context): Api["settings"] {
  const actor = (): string => requireUser(ctx).name;

  return {
    get: () => getPlatformSettings(),

    async update(patch: DeepPartial<PlatformSettings>) {
      const author = actor();
      return db().$transaction(async (tx) => {
        const current = await getPlatformSettings(tx);
        const next = validate(overlay(current, patch));
        const domainChanged = next.baseDomain !== current.baseDomain;
        await savePlatformSettings(next, tx);
        await recordActivity(
          {
            type: "settings.updated",
            title: "Réglages de la plateforme modifiés",
            description: next.workspaceName,
            actor: author,
          },
          tx,
        );
        // Public database URLs live under a domain derived from the base domain.
        await emit(domainChanged ? ["settings", "databases"] : ["settings"], {}, tx);
        return next;
      });
    },

    async getProfile() {
      return requireUser(ctx);
    },

    async updateProfile(rawPatch) {
      const me = requireUser(ctx);
      const patch = asRecord(rawPatch);
      const name = patch.name !== undefined ? validPersonName(patch.name) : me.name;
      const email = patch.email !== undefined ? validEmail(patch.email) : me.email;
      const taken = await db().user.findFirst({ where: { email, NOT: { id: me.id } } });
      if (taken) throw conflict("Cette adresse e-mail est déjà utilisée par un membre.", "email");
      try {
        const row = await db().user.update({ where: { id: me.id }, data: { name, email } });
        await emit(["settings"]);
        return toUserProfile(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("Cette adresse e-mail est déjà utilisée par un membre.", "email");
        }
        throw error;
      }
    },

    async listTokens() {
      const me = requireUser(ctx);
      const rows = await db().apiToken.findMany({
        where: { userId: me.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return rows.map(toApiToken);
    },

    async createToken(rawInput) {
      const me = requireUser(ctx);
      const input = asRecord(rawInput);
      const name = asString(input.name).trim();
      if (name.length < 2 || name.length > 40) {
        throw validation("Le nom du jeton doit contenir entre 2 et 40 caractères.", "name");
      }
      const expiresInDays = input.expiresInDays ?? null;
      if (expiresInDays !== null && !inRange(expiresInDays, 1, 365)) {
        throw validation("La durée de validité doit être comprise entre 1 et 365 jours.", "expiresInDays");
      }
      const existing = await db().apiToken.findMany({ where: { userId: me.id }, select: { name: true } });
      if (existing.some((token) => sameName(token.name, name))) {
        throw conflict("Un jeton porte déjà ce nom.", "name");
      }

      const generated = generateApiToken();
      const row = await db().$transaction(async (tx) => {
        const created = await tx.apiToken.create({
          data: {
            id: newId("tok"),
            userId: me.id,
            name,
            prefix: generated.prefix,
            tokenHash: generated.tokenHash,
            expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * DAY_MS),
          },
        });
        await recordActivity(
          { type: "settings.updated", title: "Jeton d’API créé", description: name, actor: me.name },
          tx,
        );
        await emit(["settings"], {}, tx);
        return created;
      });
      return { token: toApiToken(row), secret: generated.secret };
    },

    async revokeToken(id) {
      const me = requireUser(ctx);
      await db().$transaction(async (tx) => {
        const token = await tx.apiToken.findFirst({ where: { id: asString(id), userId: me.id } });
        if (!token) throw notFound("Jeton");
        await tx.apiToken.delete({ where: { id: token.id } });
        await recordActivity(
          {
            type: "settings.updated",
            severity: "warning",
            title: "Jeton d’API révoqué",
            description: token.name,
            actor: me.name,
          },
          tx,
        );
        await emit(["settings"], {}, tx);
      });
    },

    // The owner first, then the most recent members.
    async listMembers() {
      const rows = await db().user.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      return rows
        .map(toTeamMember)
        .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
    },

    async inviteMember(rawInput) {
      const author = actor();
      const input = asRecord(rawInput);
      const email = validEmail(input.email);
      const role = input.role;
      assertAssignable(role);
      if (await db().user.findUnique({ where: { email } })) {
        throw conflict("Ce membre fait déjà partie de l’espace de travail.", "email");
      }
      try {
        return await db().$transaction(async (tx) => {
          const row = await tx.user.create({
            data: { id: newId("usr"), name: nameFromEmail(email), email, role, status: "invited" },
          });
          await recordActivity(
            { type: "settings.updated", title: "Membre invité", description: email, actor: author },
            tx,
          );
          await emit(["settings"], {}, tx);
          return toTeamMember(row);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("Ce membre fait déjà partie de l’espace de travail.", "email");
        }
        throw error;
      }
    },

    async updateMember(id, rawPatch) {
      const role = asRecord(rawPatch).role;
      return db().$transaction(async (tx) => {
        const member = await tx.user.findUnique({ where: { id: asString(id) } });
        if (!member) throw notFound("Membre");
        if (member.role === "owner") {
          throw forbidden("Le rôle du propriétaire ne peut pas être modifié.");
        }
        assertAssignable(role);
        const row = await tx.user.update({ where: { id: member.id }, data: { role } });
        await emit(["settings"], {}, tx);
        return toTeamMember(row);
      });
    },

    async removeMember(id) {
      const author = actor();
      await db().$transaction(async (tx) => {
        const member = await tx.user.findUnique({ where: { id: asString(id) } });
        if (!member) throw notFound("Membre");
        if (member.role === "owner") {
          throw forbidden("Le propriétaire ne peut pas être retiré de l’espace de travail.");
        }
        // Sessions and API tokens go with the account (ON DELETE CASCADE).
        await tx.user.delete({ where: { id: member.id } });
        await recordActivity(
          {
            type: "settings.updated",
            severity: "warning",
            title: "Membre retiré",
            description: member.email,
            actor: author,
          },
          tx,
        );
        await emit(["settings"], {}, tx);
      });
    },

    async resetDemoData() {
      throw forbidden(
        "La réinitialisation des données de démonstration n’existe que dans le simulateur.",
      );
    },
  };
}
