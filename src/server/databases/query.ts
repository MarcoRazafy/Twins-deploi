/**
 * The read-only SQL console. Guarantees, from the strongest:
 * - the statement runs in a `BEGIN READ ONLY` transaction that is always rolled
 *   back, on a session where default_transaction_read_only is on and
 *   statement_timeout is 5 s (see connectToDatabase);
 * - exactly one statement: a small scanner of strings, comments and dollar
 *   quotes finds the top-level semicolons (the server would run several
 *   statements of one message as a single implicit transaction);
 * - at most 500 rows, fetched through a cursor for SELECT-like statements so
 *   that a huge table is never loaded in memory.
 * This is a guard against accidents on the user's own database, not a
 * privilege boundary: the container itself is the sandbox.
 */

import type { Client } from "pg";

import type { ApiError } from "@/lib/api/contract";
import type { DatabaseRow, QueryResult } from "@/lib/types";

import { unavailable, validation } from "../errors";
import { toCell } from "./tables";

export const MAX_QUERY_ROWS = 500;
export const MAX_SQL_LENGTH = 100_000;

/** First keywords that a cursor accepts. */
const CURSOR_KEYWORDS = new Set(["SELECT", "WITH", "VALUES", "TABLE", "("]);
const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$\u0080-￿]/;

export interface ScannedStatement {
  /** The statement, trimmed, without its terminating semicolon. */
  statement: string;
  /** Upper-cased first word ("SELECT"), or "(". */
  keyword: string;
}

function skipQuoted(source: string, start: number, quote: string, backslashEscapes: boolean): number {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (backslashEscapes && char === "\\") {
      index += 2;
    } else if (char === quote) {
      if (source[index + 1] !== quote) return index + 1;
      index += 2;
    } else {
      index += 1;
    }
  }
  return source.length;
}

/** PostgreSQL block comments nest. */
function skipBlockComment(source: string, start: number): number {
  let depth = 1;
  let index = start + 2;
  while (index < source.length && depth > 0) {
    if (source.startsWith("/*", index)) {
      depth += 1;
      index += 2;
    } else if (source.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
    } else {
      index += 1;
    }
  }
  return index;
}

/** "$tag$" or "$$" opening a dollar-quoted string at `index`, null for anything else ($1, a$b…). */
function dollarTag(source: string, index: number): string | null {
  if (index > 0 && IDENTIFIER_CHARACTER.test(source[index - 1])) return null;
  const match = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(source.slice(index, index + 80));
  return match ? match[0] : null;
}

/** Checks that `sql` holds exactly one statement and returns it. */
export function scanStatement(sql: string): ScannedStatement {
  if (sql.length > MAX_SQL_LENGTH) throw validation("La requête est trop longue.", "sql");

  let index = 0;
  let end = -1;
  let keyword = "";
  let significant = false;

  const startToken = (): void => {
    if (end !== -1) throw validation("Une seule instruction SQL est autorisée à la fois.", "sql");
    significant = true;
    if (keyword === "") {
      keyword = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(index, index + 40))?.[0].toUpperCase() ?? sql[index];
    }
  };

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "-" && next === "-") {
      const lineEnd = sql.indexOf("\n", index);
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
    } else if (char === "/" && next === "*") {
      index = skipBlockComment(sql, index);
    } else if (char === ";") {
      // Empty statements before the first token do not count.
      if (significant && end === -1) end = index;
      index += 1;
    } else if (/\s/.test(char)) {
      index += 1;
    } else if (char === "'") {
      startToken();
      // E'…' strings accept backslash escapes, plain ones do not (standard_conforming_strings).
      const before = index > 0 ? sql[index - 1] : "";
      const escapes = (before === "E" || before === "e") && !(index > 1 && IDENTIFIER_CHARACTER.test(sql[index - 2]));
      index = skipQuoted(sql, index, "'", escapes);
    } else if (char === '"') {
      startToken();
      index = skipQuoted(sql, index, '"', false);
    } else if (char === "$" && dollarTag(sql, index) !== null) {
      startToken();
      const tag = dollarTag(sql, index) ?? "$$";
      const close = sql.indexOf(tag, index + tag.length);
      index = close === -1 ? sql.length : close + tag.length;
    } else {
      startToken();
      index += 1;
    }
  }

  if (!significant) throw validation("Saisissez une requête SQL.", "sql");
  return { statement: sql.slice(0, end === -1 ? sql.length : end).trim(), keyword };
}

/** SQLSTATE errors raised by the server (as opposed to network failures). */
function isSqlError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code);
}

/** The server's message is the most useful feedback in a console; it never contains our credentials. */
function failure(error: unknown): ApiError {
  return isSqlError(error)
    ? validation(error.message, "sql")
    : unavailable("La connexion à la base de données a été interrompue.");
}

interface Fetched {
  command: string;
  names: string[];
  rows: unknown[][];
}

async function execute(client: Client, scanned: ScannedStatement): Promise<Fetched> {
  await client.query("BEGIN READ ONLY");
  try {
    if (CURSOR_KEYWORDS.has(scanned.keyword)) {
      await client.query(`DECLARE mr_console NO SCROLL CURSOR FOR ${scanned.statement}`);
      const page = await client.query<unknown[]>({
        text: `FETCH ${MAX_QUERY_ROWS + 1} FROM mr_console`,
        rowMode: "array",
      });
      return { command: "SELECT", names: page.fields.map((field) => field.name), rows: page.rows };
    }
    const result = await client.query<unknown[]>({ text: scanned.statement, rowMode: "array" });
    return { command: result.command || "SELECT", names: result.fields.map((field) => field.name), rows: result.rows };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
  }
}

/** "a", "a", "b" → "a", "a (2)", "b": rows are objects, same-named columns must not overwrite each other. */
function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

/** Runs one scanned statement on a read-only session (see connectToDatabase). */
export async function runReadOnlyQuery(client: Client, scanned: ScannedStatement): Promise<QueryResult> {
  const started = performance.now();
  let fetched: Fetched;
  try {
    fetched = await execute(client, scanned);
  } catch (error) {
    throw failure(error);
  }
  const durationMs = Math.round((performance.now() - started) * 100) / 100;

  const columns = uniqueNames(fetched.names);
  const rows: DatabaseRow[] = fetched.rows
    .slice(0, MAX_QUERY_ROWS)
    .map((values) => Object.fromEntries(columns.map((name, index) => [name, toCell(values[index])])));
  return { command: fetched.command, columns, rows, rowCount: rows.length, durationMs };
}
