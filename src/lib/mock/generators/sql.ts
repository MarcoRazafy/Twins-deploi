/**
 * The tiny SQL dialect understood by the console of the simulator:
 *   SELECT * FROM <table> [LIMIT n]
 *   SELECT COUNT(*) FROM <table>
 *   SELECT version()   ·   SELECT now()
 *   SELECT … FROM information_schema.tables | pg_tables   (table listing)
 */

import type { DatabaseRow } from "@/lib/types";

import { invalid } from "../errors";
import type { DatasetKey } from "../schema";
import { postgresFullVersion } from "./boot";
import { describeTables, findTable, readRows } from "./tables";

export interface SqlContext {
  dataset: DatasetKey | null;
  /** PostgreSQL major version. */
  version: string;
  /** Database name ("railway"). */
  database: string;
  /** Seeding time: keeps generated dates stable. */
  anchor: number;
  now: number;
}

export interface SqlResult {
  command: string;
  columns: string[];
  rows: DatabaseRow[];
}

/**
 * An unbounded `SELECT *` is capped, like the row limit of most SQL clients
 * (an explicit LIMIT may go up to twice that).
 */
const MAX_ROWS = 500;

const UNSUPPORTED =
  "Le simulateur ne prend en charge que des requêtes SELECT simples : SELECT * FROM table [LIMIT n], SELECT COUNT(*) FROM table, SELECT version(), SELECT now(), ou la liste des tables via information_schema.tables.";

const CATALOGS: Record<string, string[]> = {
  "information_schema.tables": ["table_catalog", "table_schema", "table_name", "table_type"],
  pg_tables: ["schemaname", "tablename", "tableowner", "hasindexes"],
};

function normaliseTarget(raw: string): string {
  const target = raw.replace(/"/g, "").toLowerCase();
  return target === "pg_catalog.pg_tables" ? "pg_tables" : target;
}

function relationMissing(name: string): never {
  throw invalid(`ERROR: relation "${name}" does not exist`);
}

function catalogRows(target: string, context: SqlContext): DatabaseRow[] {
  return describeTables(context.dataset).map((table): DatabaseRow =>
    target === "pg_tables"
      ? { schemaname: table.schema, tablename: table.name, tableowner: "postgres", hasindexes: true }
      : {
          table_catalog: context.database,
          table_schema: table.schema,
          table_name: table.name,
          table_type: "BASE TABLE",
        },
  );
}

/** Resolves the select list of a catalog query to [source column, output name] pairs. */
function selectList(list: string, available: string[]): Array<[string, string]> {
  if (list.trim() === "*") return available.map((name) => [name, name]);
  return list.split(",").map((item) => {
    const match = /^"?([a-z_][a-z0-9_]*)"?(?:\s+as\s+"?([a-z_][a-z0-9_]*)"?)?$/i.exec(item.trim());
    if (!match) throw invalid(UNSUPPORTED);
    const name = match[1].toLowerCase();
    if (!available.includes(name)) throw invalid(`ERROR: column "${name}" does not exist`);
    return [name, (match[2] ?? name).toLowerCase()];
  });
}

function userTable(target: string, context: SqlContext) {
  const parts = target.split(".");
  const name = parts[parts.length - 1];
  const table = parts.length <= 2 && (parts.length === 1 || parts[0] === "public")
    ? findTable(context.dataset, name)
    : undefined;
  if (!table || !context.dataset) return relationMissing(target);
  return { table, dataset: context.dataset };
}

function nowValue(ms: number): string {
  const date = new Date(ms).toISOString();
  // PostgreSQL prints microseconds.
  return `${date.slice(0, 10)} ${date.slice(11, 23)}${String(ms % 997).padStart(3, "0")}+00`;
}

export function runSql(input: string, context: SqlContext): SqlResult {
  const sql = input.trim().replace(/;+\s*$/, "").replace(/\s+/g, " ");
  if (!sql) throw invalid("Saisissez une requête SQL.");
  if (sql.includes(";")) throw invalid("Exécutez une seule requête à la fois.");

  if (/^select\s+version\s*\(\s*\)$/i.test(sql)) {
    const version = postgresFullVersion(context.version);
    return {
      command: "SELECT",
      columns: ["version"],
      rows: [
        {
          version: `PostgreSQL ${version} (Debian ${version}-1.pgdg120+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit`,
        },
      ],
    };
  }

  if (/^select\s+(now\s*\(\s*\)|current_timestamp)$/i.test(sql)) {
    return { command: "SELECT", columns: ["now"], rows: [{ now: nowValue(context.now) }] };
  }

  const count = /^select\s+count\s*\(\s*\*\s*\)\s+from\s+([a-z0-9_."]+)$/i.exec(sql);
  if (count) {
    const target = normaliseTarget(count[1]);
    const total = CATALOGS[target]
      ? describeTables(context.dataset).length
      : userTable(target, context).table.rowCount;
    return { command: "SELECT", columns: ["count"], rows: [{ count: total }] };
  }

  const select = /^select\s+(.+?)\s+from\s+([a-z0-9_."]+)(.*)$/i.exec(sql);
  if (!select) throw invalid(UNSUPPORTED);
  const target = normaliseTarget(select[2]);
  const rest = select[3].trim();

  const catalog = CATALOGS[target];
  if (catalog) {
    // WHERE / ORDER BY are accepted and ignored: only user tables are listed anyway.
    const columns = selectList(select[1], catalog);
    const limit = /\blimit\s+(\d+)$/i.exec(rest);
    const rows = catalogRows(target, context)
      .slice(0, limit ? Number(limit[1]) : undefined)
      .map((row) => Object.fromEntries(columns.map(([source, output]) => [output, row[source]])));
    return { command: "SELECT", columns: columns.map(([, output]) => output), rows };
  }

  const limit = /^limit\s+(\d+)$/i.exec(rest);
  if (select[1].trim() !== "*" || (rest !== "" && !limit)) throw invalid(UNSUPPORTED);
  const { table, dataset } = userTable(target, context);
  const wanted = limit ? Math.min(Number(limit[1]), MAX_ROWS * 2) : MAX_ROWS;
  const rows = readRows(dataset, table, 0, wanted, context.anchor);
  return { command: "SELECT", columns: table.columns.map((item) => item.name), rows };
}
