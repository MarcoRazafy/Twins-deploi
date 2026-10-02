import type { Database } from "@/lib/types";

const MASK = "••••••••";

/** Hides the password inside a connection string or a snippet, for display only. */
export function maskPassword(text: string, password: string): string {
  return password ? text.split(password).join(MASK) : text;
}

/** What other services declare to consume the database: resolved at deploy time. */
export function referenceVariable(database: Pick<Database, "name">): string {
  return `DATABASE_URL=\${{${database.name}.DATABASE_URL}}`;
}

export type SnippetId = "psql" | "node" | "prisma" | "python";

export interface Snippet {
  id: SnippetId;
  /** Tab label. */
  label: string;
  /** Caption of the code block header. */
  file: string;
  /** One line under the block: what to install or configure. */
  hint: string;
  build: (url: string) => string;
}

export const SNIPPET_ORDER: readonly SnippetId[] = ["psql", "node", "prisma", "python"];

export const SNIPPETS: Record<SnippetId, Snippet> = {
  psql: {
    id: "psql",
    label: "psql",
    file: "Terminal",
    hint: "Nécessite le client en ligne de commande psql.",
    build: (url) => `psql "${url}"`,
  },
  node: {
    id: "node",
    label: "Node.js",
    file: "db.mjs",
    hint: "Installez le pilote avec npm install pg.",
    build: (url) =>
      [
        'import pg from "pg";',
        "",
        "const client = new pg.Client({",
        `  connectionString: "${url}",`,
        "});",
        "",
        "await client.connect();",
        'const { rows } = await client.query("SELECT now()");',
        "console.log(rows[0]);",
        "await client.end();",
      ].join("\n"),
  },
  prisma: {
    id: "prisma",
    label: "Prisma",
    file: ".env",
    hint: 'Référencez la variable dans schema.prisma avec url = env("DATABASE_URL").',
    build: (url) => `DATABASE_URL="${url}"`,
  },
  python: {
    id: "python",
    label: "Python",
    file: "main.py",
    hint: 'Installez le pilote avec pip install "psycopg[binary]".',
    build: (url) =>
      [
        "import psycopg",
        "",
        `with psycopg.connect("${url}") as conn:`,
        '    row = conn.execute("SELECT version()").fetchone()',
        "    print(row)",
      ].join("\n"),
  },
};
