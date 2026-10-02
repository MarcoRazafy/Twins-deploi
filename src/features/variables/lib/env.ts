/**
 * Pure helpers for environment variables: key rules, the `.env` text format
 * (parse, serialise, diff), `${{ Service.KEY }}` references and the reference
 * suggestions offered on a service.
 */

import { pluralize, slugify } from "@/lib/format";
import type { EnvVariable, Service } from "@/lib/types";

/** Same rule as the API: letters, digits and underscores, not starting with a digit. */
export const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A `${{ Service.KEY }}` reference anywhere in a value. */
export const REFERENCE_PATTERN = /\$\{\{\s*[^}]+\s*\}\}/;

/** Shown in hints; concatenated so the text never reads as a template literal. */
export const REFERENCE_EXAMPLE = "$" + "{{Service.VARIABLE}}";

// ─────────────────────────────────────────────────────────────────────────────
// Keys
// ─────────────────────────────────────────────────────────────────────────────

/** French message when the key is unusable, `null` when it is fine. */
export function validateKey(key: string): string | null {
  if (!key) return "Le nom de la variable est requis.";
  if (!KEY_PATTERN.test(key)) {
    return "Utilisez des lettres, des chiffres et « _ », sans commencer par un chiffre.";
  }
  return null;
}

/** Closest conventional name ("api-key" becomes "API_KEY"), "" when nothing usable is left. */
export function suggestKey(raw: string): string {
  const cleaned = raw
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  const key = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
  return KEY_PATTERN.test(key) ? key : "";
}

/** Names that usually hold credentials: the "Secret" switch starts on for them. */
export function looksSensitive(key: string): boolean {
  return /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|(^|_)KEY(_|$)|DATABASE_URL/i.test(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// References
// ─────────────────────────────────────────────────────────────────────────────

export interface EnvReference {
  /** The reference as written, e.g. `${{Postgres.DATABASE_URL}}`. */
  raw: string;
  /** Text before the dot: a service name, or "shared". */
  service: string;
  key: string | null;
  shared: boolean;
}

export function findReferences(value: string): EnvReference[] {
  return Array.from(value.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g), (match) => {
    const inner = match[1] ?? "";
    const dot = inner.indexOf(".");
    const service = (dot === -1 ? inner : inner.slice(0, dot)).trim();
    const key = dot === -1 ? null : inner.slice(dot + 1).trim() || null;
    return { raw: match[0], service, key, shared: service.toLowerCase() === "shared" };
  });
}

/** What a reference points at, for tooltips. */
export function describeReference({ service, key, shared }: EnvReference): string {
  if (shared) return key ? `Variable partagée ${key}` : "Variables partagées";
  if (key) return `${key} du service ${service}`;
  return `Service ${service}`;
}

export function databaseUrlReference(serviceName: string): string {
  return `\${{${serviceName}.DATABASE_URL}}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// .env text format
// ─────────────────────────────────────────────────────────────────────────────

export interface EnvEntry {
  key: string;
  value: string;
  /** 1-based line where the entry starts. */
  line: number;
}

export interface EnvIssue {
  line: number;
  message: string;
}

export interface ParsedEnv {
  entries: EnvEntry[];
  issues: EnvIssue[];
  /** Keys defined more than once (the last occurrence wins, like a .env file). */
  duplicates: string[];
}

const QUOTES = new Set(['"', "'", "`"]);
const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };

/** Index of the quote closing the one at index 0, -1 when it is missing. */
function findClosingQuote(text: string, quote: string): number {
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"' && char === "\\") {
      index += 1;
    } else if (char === quote) {
      return index;
    }
  }
  return -1;
}

/**
 * Reads `.env` text: blank lines and `#` comments are skipped, `export ` is
 * accepted, values may be quoted (double quotes support `\n`-style escapes
 * and quoted values may span several lines) and an unquoted value stops at
 * ` #`.
 */
export function parseEnv(source: string): ParsedEnv {
  const lines = source.split(/\r\n|\r|\n/);
  const entries: EnvEntry[] = [];
  const issues: EnvIssue[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const startLine = index + 1;
    const statement = trimmed.replace(/^export\s+/, "");
    const equals = statement.indexOf("=");
    if (equals === -1) {
      issues.push({ line: startLine, message: "Format attendu : NOM=valeur." });
      continue;
    }

    const key = statement.slice(0, equals).trim();
    const valuePart = statement.slice(equals + 1).trimStart();
    const quote = valuePart[0];
    let value: string;

    if (quote !== undefined && QUOTES.has(quote)) {
      let text = valuePart;
      let lastLine = index;
      let close = findClosingQuote(text, quote);
      while (close === -1 && lastLine + 1 < lines.length) {
        lastLine += 1;
        text += `\n${lines[lastLine]}`;
        close = findClosingQuote(text, quote);
      }
      if (close === -1) {
        issues.push({ line: startLine, message: "Guillemet non fermé." });
        continue;
      }
      index = lastLine;

      const trailing = text.slice(close + 1).trim();
      if (trailing && !trailing.startsWith("#")) {
        issues.push({
          line: startLine,
          message: "Texte inattendu après la valeur entre guillemets.",
        });
        continue;
      }
      const inner = text.slice(1, close);
      value =
        quote === '"'
          ? inner.replace(/\\([nrt"\\])/g, (_match, char: string) => ESCAPES[char] ?? char)
          : inner;
    } else {
      const comment = valuePart.search(/(^|\s)#/);
      value = (comment === -1 ? valuePart : valuePart.slice(0, comment)).trim();
    }

    if (!key) {
      issues.push({ line: startLine, message: "Nom de variable manquant avant « = »." });
      continue;
    }
    if (!KEY_PATTERN.test(key)) {
      issues.push({ line: startLine, message: `Nom de variable invalide : « ${key} ».` });
      continue;
    }

    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
    entries.push({ key, value, line: startLine });
  }

  return { entries, issues, duplicates: [...duplicates] };
}

function formatValue(value: string): string {
  if (!/[\s"'`#\\]/.test(value)) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** `KEY=value` lines; values that need it are double-quoted so `parseEnv` reads them back. */
export function serializeEnv(variables: ReadonlyArray<Pick<EnvVariable, "key" | "value">>): string {
  return variables.map(({ key, value }) => `${key}=${formatValue(value)}`).join("\n");
}

export interface EnvDiff {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
  /** Deduplicated entries to send to the API, in file order. */
  entries: Array<{ key: string; value: string }>;
}

/** What applying `parsed` over `current` (with `replace`) would add, change and remove. */
export function diffEnv(
  current: ReadonlyArray<Pick<EnvVariable, "key" | "value">>,
  parsed: readonly EnvEntry[],
): EnvDiff {
  const next = new Map<string, string>();
  for (const entry of parsed) {
    next.delete(entry.key);
    next.set(entry.key, entry.value);
  }
  const existing = new Map(current.map((variable) => [variable.key, variable.value] as const));

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;

  for (const [key, value] of next) {
    const previous = existing.get(key);
    if (previous === undefined) added.push(key);
    else if (previous !== value) changed.push(key);
    else unchanged += 1;
  }
  for (const key of existing.keys()) {
    if (!next.has(key)) removed.push(key);
  }

  return {
    added,
    changed,
    removed,
    unchanged,
    entries: Array.from(next, ([key, value]) => ({ key, value })),
  };
}

/** "2 ajouts · 1 modification · 1 suppression" (empty parts are left out). */
export function summarizeDiff(diff: Pick<EnvDiff, "added" | "changed" | "removed">): string {
  return [
    diff.added.length > 0 ? pluralize(diff.added.length, "ajout") : "",
    diff.changed.length > 0 ? pluralize(diff.changed.length, "modification") : "",
    diff.removed.length > 0 ? pluralize(diff.removed.length, "suppression") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggestions
// ─────────────────────────────────────────────────────────────────────────────

export interface ReferenceSuggestion {
  /** Id of the PostgreSQL service the reference points at. */
  id: string;
  key: string;
  value: string;
  databaseName: string;
}

/**
 * One `DATABASE_URL=${{<Db>.DATABASE_URL}}` per PostgreSQL service of the
 * project that nothing references yet (neither this service nor the shared
 * variables it inherits). A PostgreSQL service itself gets none. When the
 * usual key is taken, the database name prefixes it.
 */
export function buildReferenceSuggestions({
  serviceId,
  services,
  own,
  shared,
}: {
  serviceId: string;
  services: readonly Service[];
  own: readonly EnvVariable[];
  shared: readonly EnvVariable[];
}): ReferenceSuggestion[] {
  const current = services.find((service) => service.id === serviceId);
  if (!current || current.source.type === "postgres") return [];

  const referenced = new Set<string>();
  for (const variable of [...own, ...shared]) {
    for (const reference of findReferences(variable.value)) {
      referenced.add(reference.service.toLowerCase());
    }
  }
  const takenKeys = new Set(own.map((variable) => variable.key));

  const suggestions: ReferenceSuggestion[] = [];
  for (const database of services) {
    if (database.source.type !== "postgres" || database.id === serviceId) continue;
    if (referenced.has(database.name.toLowerCase())) continue;

    const prefixed = `${slugify(database.name).toUpperCase().replace(/-/g, "_")}_DATABASE_URL`;
    const key = ["DATABASE_URL", prefixed].find(
      (candidate) => KEY_PATTERN.test(candidate) && !takenKeys.has(candidate),
    );
    if (!key) continue;

    // Two databases must not propose the same key.
    takenKeys.add(key);
    suggestions.push({
      id: database.id,
      key,
      value: databaseUrlReference(database.name),
      databaseName: database.name,
    });
  }
  return suggestions;
}
