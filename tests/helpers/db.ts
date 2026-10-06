import { db } from "@/server/db";

let tables: string[] | null = null;

/**
 * Empties every table of the test database (migrations table kept).
 * DELETE rather than TRUNCATE: on tables this small it is several times faster
 * (TRUNCATE rewrites every relation and index), and every foreign key of the
 * schema is ON DELETE CASCADE, so the order does not matter.
 */
export async function resetDatabase(): Promise<void> {
  tables ??= (
    await db().$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `
  ).map((row) => row.tablename);
  if (tables.length === 0) return;
  await db().$transaction(tables.map((table) => db().$executeRawUnsafe(`DELETE FROM "${table}"`)));
}
