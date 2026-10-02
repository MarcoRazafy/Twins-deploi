/**
 * Demo tables behind the data browser and the SQL console. Rows are generated
 * on demand from (dataset, table, row index): nothing is stored, and paging
 * through a 48 000-row table costs nothing.
 */

import type { DatabaseRow, DatabaseTable } from "@/lib/types";

import type { DatasetKey } from "../schema";
import { BOUTIQUE_TABLES } from "./datasets/boutique";
import { CANCHAM_TABLES } from "./datasets/cancham";
import { OBSERVATOIRE_TABLES } from "./datasets/observatoire";
import type { TableSpec } from "./datasets/shared";
import { seededRng } from "./prng";

const DATASETS: Record<DatasetKey, TableSpec[]> = {
  cancham: CANCHAM_TABLES,
  boutique: BOUTIQUE_TABLES,
  observatoire: OBSERVATOIRE_TABLES,
};

export type { TableSpec };

export function tableSpecs(dataset: DatasetKey | null): TableSpec[] {
  return dataset ? DATASETS[dataset] : [];
}

export function findTable(dataset: DatasetKey | null, name: string): TableSpec | undefined {
  const wanted = name.toLowerCase();
  return tableSpecs(dataset).find((table) => table.name === wanted);
}

/** Alphabetical, like `\dt`. */
export function describeTables(dataset: DatasetKey | null): DatabaseTable[] {
  return tableSpecs(dataset)
    .map((table) => ({
      schema: "public",
      name: table.name,
      rowCount: table.rowCount,
      // Heap + indexes, rounded up to 8 kB pages.
      sizeKb: Math.ceil((table.rowCount * table.rowBytes * 1.35) / 8192) * 8 + 16,
      columns: table.columns,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readRows(
  dataset: DatasetKey,
  table: TableSpec,
  offset: number,
  limit: number,
  anchor: number,
): DatabaseRow[] {
  const start = Math.max(0, Math.floor(offset));
  const end = Math.min(table.rowCount, start + Math.max(0, Math.floor(limit)));
  const rows: DatabaseRow[] = [];
  for (let index = start; index < end; index += 1) {
    rows.push(table.row(index, seededRng(dataset, table.name, index), anchor));
  }
  return rows;
}
