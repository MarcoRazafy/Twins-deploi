/**
 * Tables and rows of a project database, for the "Data" tab. Identifiers are
 * never interpolated from user input: the requested table must match an entry
 * of the table list read from the server, and its schema and name are then
 * quoted by the driver. Rows are inserted, updated and deleted one at a time,
 * by primary key, with the values passed as query parameters.
 */

import type { Client } from "pg";

import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseRow,
  DatabaseTable,
  DatabaseTableData,
} from "@/lib/types";

import { notFound, validation } from "../errors";

/** Cells longer than this are cut: the grid is not a file viewer. */
const MAX_CELL_CHARS = 20_000;
/** Tables never vacuumed report -1 rows: counted exactly, within this budget. */
const MAX_EXACT_COUNTS = 50;
/** Above this estimate the total is not counted exactly (it would scan the table). */
const MAX_EXACT_TOTAL = 1_000_000;

/** A table of the list plus the planner's row estimate (-1 when unknown). */
export interface TableInfo extends DatabaseTable {
  estimate: number;
}

export function toCell(value: unknown): DatabaseCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  let text: string;
  if (typeof value === "string") text = value;
  else if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  else if (Buffer.isBuffer(value)) text = `\\x${value.toString("hex")}`;
  else text = JSON.stringify(value) ?? "";
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}

interface TableRow {
  schema: string;
  name: string;
  estimate: number;
  size_kb: number;
}
interface ColumnRow {
  schema: string;
  name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
}
interface KeyRow {
  schema: string;
  name: string;
  column_name: string;
}

const keyOf = (schema: string, name: string): string => `${schema}\u0000${name}`;

/** "ARRAY" and "USER-DEFINED" say nothing: show the element type or the enum name. */
function typeName(row: ColumnRow): string {
  if (row.data_type === "ARRAY") return `${row.udt_name.replace(/^_/, "")}[]`;
  if (row.data_type === "USER-DEFINED") return row.udt_name;
  return row.data_type;
}

function qualified(client: Client, schema: string, name: string): string {
  return `${client.escapeIdentifier(schema)}.${client.escapeIdentifier(name)}`;
}

/** Every user table with its columns, statistics from pg_class and primary key columns. */
export async function describeTables(client: Client): Promise<TableInfo[]> {
  const tables = await client.query<TableRow>(
    `SELECT n.nspname AS schema, c.relname AS name, c.reltuples::float8 AS estimate,
            (pg_total_relation_size(c.oid) / 1024)::float8 AS size_kb
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
     ORDER BY n.nspname, c.relname`,
  );
  const columns = await client.query<ColumnRow>(
    `SELECT table_schema AS schema, table_name AS name, column_name, data_type, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema !~ '^pg_' AND table_schema <> 'information_schema'
     ORDER BY table_schema, table_name, ordinal_position`,
  );
  const keys = await client.query<KeyRow>(
    `SELECT kcu.table_schema AS schema, kcu.table_name AS name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_schema = tc.constraint_schema
      AND kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
      AND kcu.table_name = tc.table_name
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema !~ '^pg_' AND tc.table_schema <> 'information_schema'`,
  );

  const primaryKeys = new Set(keys.rows.map((row) => `${keyOf(row.schema, row.name)}\u0000${row.column_name}`));
  const columnsByTable = new Map<string, DatabaseColumn[]>();
  for (const row of columns.rows) {
    const key = keyOf(row.schema, row.name);
    const list = columnsByTable.get(key) ?? [];
    list.push({
      name: row.column_name,
      type: typeName(row),
      nullable: row.is_nullable === "YES",
      primaryKey: primaryKeys.has(`${key}\u0000${row.column_name}`),
    });
    columnsByTable.set(key, list);
  }

  const result: TableInfo[] = [];
  let exactCounts = 0;
  for (const row of tables.rows) {
    let rowCount = Math.max(0, Math.round(row.estimate));
    if (row.estimate < 0 && exactCounts < MAX_EXACT_COUNTS) {
      exactCounts += 1;
      try {
        const counted = await client.query<{ total: number }>(
          `SELECT count(*)::float8 AS total FROM ${qualified(client, row.schema, row.name)}`,
        );
        rowCount = counted.rows[0]?.total ?? 0;
      } catch {
        // A table the role cannot read: it stays listed, with an unknown (0) count.
      }
    }
    result.push({
      schema: row.schema,
      name: row.name,
      rowCount,
      sizeKb: Math.round(row.size_kb),
      columns: columnsByTable.get(keyOf(row.schema, row.name)) ?? [],
      estimate: row.estimate,
    });
  }
  return result;
}

/** "name" (public schema first) or "schema.name". */
export function findTable(tables: readonly TableInfo[], requested: string): TableInfo | undefined {
  const exact = tables.find((table) => `${table.schema}.${table.name}` === requested);
  if (exact) return exact;
  const named = tables.filter((table) => table.name === requested);
  return named.find((table) => table.schema === "public") ?? named[0];
}

/** One page of rows, ordered by primary key when there is one so that pages do not overlap. */
export async function readTable(
  client: Client,
  tables: readonly TableInfo[],
  requested: string,
  limit: number,
  offset: number,
): Promise<DatabaseTableData> {
  const table = findTable(tables, requested);
  if (!table) throw notFound("Table");

  const target = qualified(client, table.schema, table.name);
  const keyColumns = table.columns.filter((column) => column.primaryKey);
  const order =
    keyColumns.length > 0
      ? ` ORDER BY ${keyColumns.map((column) => client.escapeIdentifier(column.name)).join(", ")}`
      : "";
  const page = await client.query<unknown[]>({
    text: `SELECT * FROM ${target}${order} LIMIT $1 OFFSET $2`,
    values: [limit, offset],
    rowMode: "array",
  });
  const rows: DatabaseRow[] = page.rows.map((values) =>
    Object.fromEntries(page.fields.map((field, index) => [field.name, toCell(values[index])])),
  );

  let total = Math.max(0, Math.round(table.estimate));
  if (table.estimate <= MAX_EXACT_TOTAL) {
    const counted = await client.query<{ total: number }>(`SELECT count(*)::float8 AS total FROM ${target}`);
    total = counted.rows[0]?.total ?? 0;
  }
  return { columns: table.columns, rows, total };
}

/** Values of a row to write: column name → value; a column left out takes its default (insert) or is unchanged (update). */
export type RowValues = Record<string, DatabaseCell>;

function writableTable(tables: readonly TableInfo[], requested: string): TableInfo {
  const table = findTable(tables, requested);
  if (!table) throw notFound("Table");
  return table;
}

/** Text parameters: the server converts them to the column type, as it does for a literal. */
function toParameter(value: DatabaseCell): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : String(value);
}

/** Checks the column names against the table read from the server: only those are quoted into the SQL. */
function checkedValues(table: TableInfo, raw: unknown, field: string, allowEmpty: boolean): [DatabaseColumn, string | null][] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw validation("Les valeurs de la ligne sont invalides.", field);
  }
  const entries: [DatabaseColumn, string | null][] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const column = table.columns.find((item) => item.name === name);
    if (!column) throw validation(`La colonne « ${name} » n’existe pas dans cette table.`, field);
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw validation(`La valeur de « ${name} » est invalide.`, field);
    }
    entries.push([column, toParameter(value as DatabaseCell)]);
  }
  if (!allowEmpty && entries.length === 0) throw validation("Aucune valeur à enregistrer.", field);
  return entries;
}

/** WHERE clause on the whole primary key; tables without one cannot be edited row by row. */
function primaryKeyFilter(
  client: Client,
  table: TableInfo,
  rawKey: unknown,
  firstIndex: number,
): { clause: string; values: (string | null)[] } {
  const keyColumns = table.columns.filter((column) => column.primaryKey);
  if (keyColumns.length === 0) {
    throw validation("Cette table n’a pas de clé primaire : modifiez ses lignes depuis la console SQL.");
  }
  const key = typeof rawKey === "object" && rawKey !== null ? (rawKey as Record<string, unknown>) : {};
  const values: (string | null)[] = [];
  const parts = keyColumns.map((column, index) => {
    const value = key[column.name];
    if (value === undefined || value === null || !["string", "number", "boolean"].includes(typeof value)) {
      throw validation(`La valeur de la clé « ${column.name} » est manquante.`, "key");
    }
    values.push(toParameter(value as DatabaseCell));
    return `${client.escapeIdentifier(column.name)} = $${firstIndex + index}`;
  });
  return { clause: parts.join(" AND "), values };
}

/** SQLSTATE errors raised by the server: their message is the useful feedback (constraint, type…). */
function sqlFailure(error: unknown): unknown {
  return error instanceof Error && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
    ? validation(error.message)
    : error;
}

/**
 * Runs `text` in a transaction that is committed only when it touched exactly
 * one row: a stale primary key (row changed or deleted meanwhile) writes nothing.
 */
async function writeOneRow(client: Client, text: string, values: (string | null)[]): Promise<void> {
  await client.query("BEGIN");
  try {
    const result = await client.query({ text, values });
    if (result.rowCount !== 1) {
      throw notFound("Ligne");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw sqlFailure(error);
  }
}

export async function insertRow(
  client: Client,
  tables: readonly TableInfo[],
  requested: string,
  rawValues: unknown,
): Promise<void> {
  const table = writableTable(tables, requested);
  const entries = checkedValues(table, rawValues, "values", true);
  const target = qualified(client, table.schema, table.name);
  const text =
    entries.length === 0
      ? `INSERT INTO ${target} DEFAULT VALUES`
      : `INSERT INTO ${target} (${entries.map(([column]) => client.escapeIdentifier(column.name)).join(", ")}) VALUES (${entries.map((_, index) => `$${index + 1}`).join(", ")})`;
  await writeOneRow(client, text, entries.map(([, value]) => value));
}

export async function updateRow(
  client: Client,
  tables: readonly TableInfo[],
  requested: string,
  rawKey: unknown,
  rawValues: unknown,
): Promise<void> {
  const table = writableTable(tables, requested);
  const entries = checkedValues(table, rawValues, "values", false);
  const filter = primaryKeyFilter(client, table, rawKey, entries.length + 1);
  const assignments = entries.map(([column], index) => `${client.escapeIdentifier(column.name)} = $${index + 1}`);
  await writeOneRow(
    client,
    `UPDATE ${qualified(client, table.schema, table.name)} SET ${assignments.join(", ")} WHERE ${filter.clause}`,
    [...entries.map(([, value]) => value), ...filter.values],
  );
}

export async function deleteRow(
  client: Client,
  tables: readonly TableInfo[],
  requested: string,
  rawKey: unknown,
): Promise<void> {
  const table = writableTable(tables, requested);
  const filter = primaryKeyFilter(client, table, rawKey, 1);
  await writeOneRow(
    client,
    `DELETE FROM ${qualified(client, table.schema, table.name)} WHERE ${filter.clause}`,
    filter.values,
  );
}
