import type { ProgressTone } from "@/components/shared/progress-bar";
import { isApiError } from "@/lib/api/contract";
import { formatMegabytes } from "@/lib/format";
import type { Database } from "@/lib/types";

/** Share of the volume above which the storage bar turns to a warning… */
const STORAGE_WARNING_PERCENT = 80;
/** …and to danger. */
const STORAGE_CRITICAL_PERCENT = 95;

type StorageFigures = Pick<Database, "storageUsedMb" | "storageLimitMb">;

/** 0–100, capped: a volume cannot be more than full. */
export function storagePercent({ storageUsedMb, storageLimitMb }: StorageFigures): number {
  if (storageLimitMb <= 0) return 0;
  return Math.min(100, (storageUsedMb / storageLimitMb) * 100);
}

export function storageTone(percent: number): ProgressTone {
  if (percent >= STORAGE_CRITICAL_PERCENT) return "danger";
  if (percent >= STORAGE_WARNING_PERCENT) return "warning";
  return "brand";
}

/** "1,2 Go / 5 Go" */
export function formatStorage({ storageUsedMb, storageLimitMb }: StorageFigures): string {
  return `${formatMegabytes(storageUsedMb)} / ${formatMegabytes(storageLimitMb)}`;
}

/** Tabs of the database page (`?tab=`); the names match the workspace service panel. */
export const DATABASE_TABS = ["overview", "data", "console", "connect", "backups", "settings"] as const;
export type DatabaseTab = (typeof DATABASE_TABS)[number];

export function parseDatabaseTab(value: string | null): DatabaseTab {
  return DATABASE_TABS.find((tab) => tab === value) ?? "overview";
}

export function isNotFoundError(error: unknown): boolean {
  return isApiError(error) && error.code === "not_found";
}
