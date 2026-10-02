/**
 * Tables and rows of a project database, for the "Data" tab. Identifiers are
 * never interpolated from user input: the requested table must match an entry
 * of the table list read from the server, and its schema and name are then
 * quoted by the driver.
 */

import type { Client } from "pg";

import type {
  DatabaseCell,
  DatabaseColumn,
  DatabaseRow,
  DatabaseTable,
  DatabaseTableData,
} from "@/lib/types";

import { notFound } from "../errors";

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
