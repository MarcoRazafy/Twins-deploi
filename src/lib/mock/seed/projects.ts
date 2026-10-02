import type {
  PlatformSettings,
  Position,
  Project,
  Service,
  ServiceConfig,
  ServiceConnection,
  ServiceSource,
  ServiceStatus,
  ServiceVolume,
} from "@/lib/types";

import { defaultConfig } from "../domain/services";
import { PRJ, REPO, SVC, type SeedClock } from "./clock";

export function seedProjects(clock: SeedClock): Project[] {
  return [
    {
      id: PRJ.cancham,
      name: "CanCham",
      slug: "cancham",
      description:
        "Portail des membres de la Chambre de commerce Canada–Madagascar : adhésions, événements et facturation.",
      color: "purple",
      environment: "production",
      region: "mg-analamanga",
      createdAt: clock.daysAgo(18),
      updatedAt: clock.hoursAgo(5.4),
    },
    {
      id: PRJ.boutique,
      name: "Boutique Vanille",
      slug: "boutique-vanille",
      description:
        "Boutique en ligne de vanille Bourbon et d’épices de Madagascar : vitrine, API de commande et traitement des paiements.",
      color: "blue",
      environment: "production",
      region: "mg-analamanga",
      createdAt: clock.daysAgo(47),
      updatedAt: clock.hoursAgo(3.1),
    },
    {
      id: PRJ.observatoire,
      name: "Observatoire",
      slug: "observatoire",
      description:
        "Tableaux de bord et automatisations : suivi des ventes, de l’audience et des adhésions.",
      color: "green",
      environment: "production",
      region: "mg-analamanga",
      createdAt: clock.daysAgo(72),
      updatedAt: clock.secondsAgo(4),
    },
    {
      id: PRJ.portfolio,
      name: "Portfolio",
      slug: "portfolio",
      description: "Site personnel et blog technique.",
      color: "amber",
      environment: "production",
      region: "mg-analamanga",
      createdAt: clock.daysAgo(130),
      updatedAt: clock.daysAgo(6),
    },
  ];
}

const PG_DATA = "/var/lib/postgresql/data";

interface ServiceSeed {
  id: string;
  projectId: string;
  name: string;
  source: ServiceSource;
  status: ServiceStatus;
  position: Position;
  volume?: ServiceVolume;
  config?: Partial<ServiceConfig>;
  primaryDomain?: string;
  /** Hours before the seeding moment. */
  createdHoursAgo: number;
}

const POSTGRES_CONFIG: Partial<ServiceConfig> = { port: 5432, restartPolicy: "always" };

const SERVICES: ServiceSeed[] = [
  // CanCham — mirrors the reference Railway project.
  {
    id: SVC.canchamPostgres,
    projectId: PRJ.cancham,
    name: "Postgres",
    source: { type: "postgres", version: "17" },
    status: "online",
    position: { x: 96, y: 96 },
    volume: { name: "postgres-volume", mountPath: PG_DATA, sizeGb: 5, usedGb: 0.42 },
    config: POSTGRES_CONFIG,
    createdHoursAgo: 431.6,
  },
  {
    id: SVC.canchamApp,
    projectId: PRJ.cancham,
    name: "cancham-app",
    source: {
      type: "github",
      repo: REPO.canchamApp,
      branch: "main",
      rootDirectory: "/",
      autoDeploy: true,
    },
    status: "online",
    position: { x: 96, y: 336 },
    volume: { name: "cancham-app-volume", mountPath: "/app/storage", sizeGb: 2, usedGb: 0.31 },
    config: { port: 3000, healthcheckPath: "/api/health" },
    primaryDomain: "app.cancham.mg",
    createdHoursAgo: 430.1,
  },

  // Boutique Vanille — laid out left to right: storefront → api → data stores.
  {
    id: SVC.boutiqueStorefront,
    projectId: PRJ.boutique,
    name: "storefront",
    source: {
      type: "github",
      repo: REPO.storefront,
      branch: "main",
      rootDirectory: "/",
      autoDeploy: true,
    },
    status: "online",
    position: { x: 96, y: 192 },
    config: { port: 3000, healthcheckPath: "/" },
    primaryDomain: "boutique-vanille.mg",
    createdHoursAgo: 1104.2,
  },
  {
    id: SVC.boutiqueApi,
    projectId: PRJ.boutique,
    name: "api",
    source: {
      type: "github",
      repo: REPO.api,
      branch: "main",
      rootDirectory: "/",
      autoDeploy: true,
    },
    status: "online",
    position: { x: 456, y: 192 },
    config: { port: 3000, healthcheckPath: "/health", memoryLimitMb: 768 },
    primaryDomain: "api-production-7c1e.up.mini-railway.app",
    createdHoursAgo: 1103.1,
  },
  {
    id: SVC.boutiqueWorker,
    projectId: PRJ.boutique,
    name: "worker",
    source: { type: "docker", image: "ghcr.io/boutique-vanille/worker", tag: "1.8.2" },
    status: "crashed",
    position: { x: 456, y: 432 },
    config: { port: 9090, memoryLimitMb: 512 },
    createdHoursAgo: 1102.1,
  },
  {
    id: SVC.boutiquePostgres,
    projectId: PRJ.boutique,
    name: "Postgres",
    source: { type: "postgres", version: "17" },
    status: "online",
    position: { x: 816, y: 96 },
    volume: { name: "postgres-volume", mountPath: PG_DATA, sizeGb: 10, usedGb: 1.23 },
    config: { ...POSTGRES_CONFIG, memoryLimitMb: 2048 },
    createdHoursAgo: 1127.1,
  },
  {
    id: SVC.boutiqueRedis,
    projectId: PRJ.boutique,
    name: "redis",
    source: { type: "docker", image: "redis", tag: "7-alpine" },
    status: "online",
    position: { x: 816, y: 336 },
    volume: { name: "redis-volume", mountPath: "/data", sizeGb: 1, usedGb: 0.06 },
    config: { port: 6379, restartPolicy: "always", cpuLimit: 0.5, memoryLimitMb: 512 },
    createdHoursAgo: 1126.1,
  },

  // Observatoire
  {
    id: SVC.observatoireMetabase,
    projectId: PRJ.observatoire,
    name: "metabase",
    source: { type: "docker", image: "metabase/metabase", tag: "v0.50.20" },
    status: "online",
    position: { x: 96, y: 96 },
    config: { port: 3000, healthcheckPath: "/api/health", cpuLimit: 2, memoryLimitMb: 2048 },
    primaryDomain: "metabase-production-b93d.up.mini-railway.app",
    createdHoursAgo: 1702.1,
  },
  {
    id: SVC.observatoireN8n,
    projectId: PRJ.observatoire,
    name: "n8n",
    source: { type: "docker", image: "n8nio/n8n", tag: "1.64.0" },
    status: "building",
    position: { x: 96, y: 312 },
    volume: { name: "n8n-volume", mountPath: "/home/node/.n8n", sizeGb: 1, usedGb: 0 },
    config: { port: 5678 },
    createdHoursAgo: 4 / 3600,
  },
  {
    id: SVC.observatoirePostgres,
    projectId: PRJ.observatoire,
    name: "Postgres",
    source: { type: "postgres", version: "16" },
    status: "online",
    position: { x: 456, y: 192 },
    volume: { name: "postgres-volume", mountPath: PG_DATA, sizeGb: 10, usedGb: 2.82 },
    config: { ...POSTGRES_CONFIG, memoryLimitMb: 2048 },
    createdHoursAgo: 1726.1,
  },

  // Portfolio
  {
    id: SVC.portfolioSite,
    projectId: PRJ.portfolio,
    name: "site",
    source: {
      type: "github",
      repo: REPO.portfolio,
      branch: "main",
      rootDirectory: "/",
      autoDeploy: false,
    },
    status: "stopped",
    position: { x: 96, y: 96 },
    config: { port: 4321, cpuLimit: 0.5, memoryLimitMb: 512 },
    createdHoursAgo: 3096.1,
  },
];

export function seedServices(clock: SeedClock, settings: PlatformSettings): Service[] {
  return SERVICES.map((seed) => ({
    id: seed.id,
    projectId: seed.projectId,
    name: seed.name,
    source: seed.source,
    status: seed.status,
    position: seed.position,
    volume: seed.volume ?? null,
    config: defaultConfig(settings, seed.config),
    primaryDomain: seed.primaryDomain ?? null,
    // Filled in by the deployment history.
    activeDeploymentId: null,
    latestDeploymentId: null,
    createdAt: clock.hoursAgo(seed.createdHoursAgo),
    updatedAt: clock.hoursAgo(seed.createdHoursAgo),
  }));
}

const CONNECTIONS: Array<[id: string, projectId: string, from: string, to: string, hoursAgo: number]> = [
  ["con_cancham_app_postgres", PRJ.cancham, SVC.canchamApp, SVC.canchamPostgres, 430],
  ["con_boutique_storefront_api", PRJ.boutique, SVC.boutiqueStorefront, SVC.boutiqueApi, 1103],
  ["con_boutique_api_postgres", PRJ.boutique, SVC.boutiqueApi, SVC.boutiquePostgres, 1103],
  ["con_boutique_api_redis", PRJ.boutique, SVC.boutiqueApi, SVC.boutiqueRedis, 1103],
  ["con_boutique_worker_redis", PRJ.boutique, SVC.boutiqueWorker, SVC.boutiqueRedis, 1102],
  ["con_boutique_worker_postgres", PRJ.boutique, SVC.boutiqueWorker, SVC.boutiquePostgres, 1102],
  ["con_observatoire_metabase_postgres", PRJ.observatoire, SVC.observatoireMetabase, SVC.observatoirePostgres, 1702],
  ["con_observatoire_n8n_postgres", PRJ.observatoire, SVC.observatoireN8n, SVC.observatoirePostgres, 3 / 3600],
];

export function seedConnections(clock: SeedClock): ServiceConnection[] {
  return CONNECTIONS.map(([id, projectId, fromServiceId, toServiceId, hoursAgo]) => ({
    id,
    projectId,
    fromServiceId,
    toServiceId,
    createdAt: clock.hoursAgo(hoursAgo),
  }));
}
