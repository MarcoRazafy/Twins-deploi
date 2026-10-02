/** Building blocks of the demo tables (Malagasy / Canadian context). */

import type { DatabaseColumn, DatabaseRow } from "@/lib/types";

import type { Rng } from "../prng";

export interface TableSpec {
  name: string;
  rowCount: number;
  /** Average row size in bytes (drives the size shown in the table list). */
  rowBytes: number;
  columns: DatabaseColumn[];
  /**
   * Row at `index` (0-based, oldest first). `anchor` is the seeding time so
   * generated dates stay put between two reads.
   */
  row(index: number, rng: Rng, anchor: number): DatabaseRow;
}

export function column(
  name: string,
  type: string,
  options: { primaryKey?: boolean; nullable?: boolean } = {},
): DatabaseColumn {
  return {
    name,
    type,
    nullable: options.nullable ?? false,
    primaryKey: options.primaryKey ?? false,
  };
}

export const id = column("id", "integer", { primaryKey: true });

export const FIRST_NAMES = [
  "Hery", "Lalaina", "Tiana", "Fara", "Miora", "Nirina", "Rija", "Tahina", "Volana", "Andry",
  "Haja", "Mamy", "Njaka", "Sitraka", "Toky", "Fanja", "Onja", "Soa", "Zo", "Aina",
  "Fitia", "Mialy", "Nomena", "Ravo", "Santatra", "Tsiry", "Kanto", "Lova", "Mahery", "Diary",
  "Camille", "Étienne", "Maude", "Olivier", "Geneviève", "Mathieu",
] as const;

export const LAST_NAMES = [
  "Rakoto", "Rabe", "Razafy", "Andriamanana", "Rasoanaivo", "Ratsimbazafy", "Randrianarisoa",
  "Rakotomalala", "Andrianaivo", "Raharison", "Razafindrakoto", "Ramanantsoa", "Rabemananjara",
  "Rakotonirina", "Andriamihaja", "Rajaonarivelo", "Ranaivoson", "Razanamparany", "Rakotoarisoa",
  "Andrianjafy", "Tremblay", "Gagnon", "Bouchard", "Lefebvre",
] as const;

export const MG_CITIES = [
  "Antananarivo", "Toamasina", "Antsirabe", "Mahajanga", "Fianarantsoa", "Toliara",
  "Antsiranana", "Nosy Be", "Sambava", "Morondava",
] as const;

export const CA_CITIES = ["Montréal", "Québec", "Ottawa", "Toronto", "Sherbrooke"] as const;

/** "Étienne Rabe" → "etienne.rabe" */
export function emailLocalPart(firstName: string, lastName: string): string {
  const ascii = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  return `${ascii(firstName)}.${ascii(lastName)}`;
}

/**
 * Timestamp of row `index` when `rowCount` rows are spread over `spanMs`
 * ending at `anchor` (older rows first, with a little jitter).
 */
export function spreadTime(
  index: number,
  rowCount: number,
  spanMs: number,
  anchor: number,
  rng: Rng,
): number {
  const step = spanMs / rowCount;
  return Math.round(anchor - (rowCount - 1 - index) * step - rng() * step);
}
