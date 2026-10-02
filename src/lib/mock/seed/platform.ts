import type { ApiToken, PlatformSettings, TeamMember, UserProfile } from "@/lib/types";

import { OWNER_NAME, type SeedClock } from "./clock";

export const OWNER_ID = "usr_marco";

export function seedSettings(): PlatformSettings {
  return {
    workspaceName: OWNER_NAME,
    baseDomain: "up.mini-railway.app",
    defaultRegion: "eu-west",
    deployments: {
      autoDeploy: true,
      buildTimeoutMin: 20,
      retention: 20,
      defaultBuilder: "nixpacks",
    },
    docker: {
      socketPath: "/var/run/docker.sock",
      registryUrl: "https://registry.mini-railway.app",
      defaultCpuLimit: 1,
      defaultMemoryLimitMb: 1024,
      autoPrune: false,
    },
    nginx: {
      clientMaxBodySizeMb: 50,
      proxyReadTimeoutSec: 60,
      gzip: true,
      http2: true,
      forceHttps: true,
    },
    dns: {
      provider: "manual",
      serverIp: "102.16.44.10",
      cnameTarget: "ingress.mini-railway.app",
    },
    notifications: {
      deploySucceeded: true,
      deployFailed: true,
      serviceCrashed: true,
      domainIssues: true,
      weeklyDigest: false,
      email: true,
      inApp: true,
    },
  };
}

export function seedProfile(): UserProfile {
  return { id: OWNER_ID, name: OWNER_NAME, email: "marco@mini-railway.app", role: "owner" };
}

export function seedMembers(clock: SeedClock): TeamMember[] {
  return [
    {
      id: "usr_tiana",
      name: "Tiana Rasoanaivo",
      email: "tiana.rasoanaivo@gmail.com",
      role: "viewer",
      status: "invited",
      joinedAt: clock.daysAgo(2),
    },
    {
      id: "usr_lalaina",
      name: "Lalaina Andriamanana",
      email: "lalaina@boutique-vanille.mg",
      role: "developer",
      status: "active",
      joinedAt: clock.daysAgo(41),
    },
    {
      id: "usr_hery",
      name: "Hery Rakotomalala",
      email: "hery@cancham.mg",
      role: "admin",
      status: "active",
      joinedAt: clock.daysAgo(96),
    },
    {
      id: OWNER_ID,
      name: OWNER_NAME,
      email: "marco@mini-railway.app",
      role: "owner",
      status: "active",
      joinedAt: clock.daysAgo(130),
    },
  ];
}

export function seedTokens(clock: SeedClock): ApiToken[] {
  return [
    {
      id: "tok_cli",
      name: "CLI portable",
      prefix: "mr_live_c41d",
      createdAt: clock.daysAgo(12),
      lastUsedAt: clock.daysAgo(2),
      expiresAt: clock.inDays(78),
    },
    {
      id: "tok_ci",
      name: "GitHub Actions · CI",
      prefix: "mr_live_9f3a",
      createdAt: clock.daysAgo(60),
      lastUsedAt: clock.hoursAgo(5.5),
      expiresAt: null,
    },
  ];
}
