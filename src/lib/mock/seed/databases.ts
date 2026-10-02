import type { DatabaseBackup, Service } from "@/lib/types";

import { refreshUrls } from "../domain/databases";
import { alphanumeric, seededRng } from "../generators/prng";
import type { DatabaseRecord, DatasetKey } from "../schema";
import { slugify } from "../text";
import { DBID, SVC, type SeedClock } from "./clock";

interface DatabaseSeed {
  id: string;
  serviceId: string;
  dataset: DatasetKey;
  storageUsedMb: number;
  connections: number;
  extensions: string[];
  /** Public TCP proxy port; omitted = private networking only. */
  proxyPort?: number;
}

const DATABASES: DatabaseSeed[] = [
  {
    id: DBID.cancham,
    serviceId: SVC.canchamPostgres,
    dataset: "cancham",
    storageUsedMb: 431,
    connections: 7,
    extensions: ["plpgsql", "pgcrypto", "uuid-ossp"],
    proxyPort: 41_822,
  },
  {
    id: DBID.boutique,
    serviceId: SVC.boutiquePostgres,
    dataset: "boutique",
    storageUsedMb: 1264,
    connections: 14,
    extensions: ["plpgsql", "pg_trgm", "unaccent"],
  },
  {
    id: DBID.observatoire,
    serviceId: SVC.observatoirePostgres,
    dataset: "observatoire",
    storageUsedMb: 2890,
    connections: 5,
    extensions: ["plpgsql", "pg_stat_statements"],
  },
];

export function seedDatabases(services: Service[], baseDomain: string): DatabaseRecord[] {
  return DATABASES.flatMap((seed): DatabaseRecord[] => {
    const service = services.find((item) => item.id === seed.serviceId);
    if (!service || service.source.type !== "postgres") return [];
    const record: DatabaseRecord = {
      id: seed.id,
      serviceId: service.id,
      projectId: service.projectId,
      name: service.name,
      engine: "postgres",
      version: service.source.version,
      status: service.status,
      host: `${slugify(service.name)}.railway.internal`,
      port: 5432,
      database: "railway",
      username: "postgres",
      password: alphanumeric(seededRng("password", seed.id), 32),
      internalUrl: "",
      publicNetworking: seed.proxyPort !== undefined,
      publicUrl: null,
      storageUsedMb: seed.storageUsedMb,
      storageLimitMb: (service.volume?.sizeGb ?? 5) * 1024,
      connections: seed.connections,
      maxConnections: 100,
      extensions: seed.extensions,
      createdAt: service.createdAt,
      dataset: seed.dataset,
      proxyPort: seed.proxyPort ?? null,
    };
    refreshUrls(record, baseDomain);
    return [record];
  });
}

type BackupSeed = [
  databaseId: string,
  n: number,
  type: "automatic" | "manual",
  label: string,
  hoursAgo: number,
  sizeMb: number,
];

const DAILY = "Sauvegarde quotidienne";

const BACKUPS: BackupSeed[] = [
  [DBID.cancham, 1, "automatic", DAILY, 7, 132],
  [DBID.cancham, 2, "automatic", DAILY, 31, 131],
  [DBID.cancham, 3, "automatic", DAILY, 55, 129],
  [DBID.cancham, 4, "manual", "Avant la migration des factures", 103, 127],
  [DBID.boutique, 1, "automatic", DAILY, 6, 388],
  [DBID.boutique, 2, "automatic", DAILY, 30, 386],
  [DBID.boutique, 3, "automatic", DAILY, 54, 383],
  [DBID.boutique, 4, "manual", "Avant les promotions de la récolte", 216, 371],
  [DBID.observatoire, 1, "automatic", DAILY, 5, 884],
  [DBID.observatoire, 2, "automatic", DAILY, 29, 879],
  [DBID.observatoire, 3, "manual", "Avant la mise à jour de Metabase", 308, 842],
];

export function seedBackups(clock: SeedClock): DatabaseBackup[] {
  return BACKUPS.map(([databaseId, n, type, label, hoursAgo, sizeMb]) => ({
    id: `bkp_${databaseId.slice(3)}_${n}`,
    databaseId,
    label,
    type,
    status: "completed",
    sizeMb,
    createdAt: clock.hoursAgo(hoursAgo),
    completedAt: clock.hoursAgo(hoursAgo - 0.02),
  }));
}
