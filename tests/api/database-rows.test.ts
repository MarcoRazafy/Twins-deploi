/**
 * Row writes of the "Data" tab (src/server/databases/tables.ts), run against
 * the test PostgreSQL in a throwaway schema.
 */

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteRow, describeTables, insertRow, updateRow } from "@/server/databases/tables";

const SCHEMA = "mr_rows_test";
let client: Client;

async function rows(): Promise<unknown[]> {
  return (await client.query(`SELECT id, name, active FROM ${SCHEMA}.items ORDER BY id`)).rows;
}

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(
    `CREATE TABLE ${SCHEMA}.items (id serial PRIMARY KEY, name text NOT NULL, active boolean DEFAULT true)`,
  );
  await client.query(`CREATE TABLE ${SCHEMA}.loose (note text)`);
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

describe("row writes", () => {
  it("inserts with defaults, updates and deletes by primary key", async () => {
    const tables = await describeTables(client);
    const table = `${SCHEMA}.items`;

    await insertRow(client, tables, table, { name: "alpha" });
    await insertRow(client, tables, table, { name: "beta", active: "false" });
    expect(await rows()).toEqual([
      { id: 1, name: "alpha", active: true },
      { id: 2, name: "beta", active: false },
    ]);

    await updateRow(client, tables, table, { id: 2 }, { name: "gamma", active: null });
    expect((await rows())[1]).toEqual({ id: 2, name: "gamma", active: null });

    await deleteRow(client, tables, table, { id: "1" });
    expect(await rows()).toEqual([{ id: 2, name: "gamma", active: null }]);
  });

  it("refuses unknown columns, stale keys, keyless tables and reports SQL errors", async () => {
    const tables = await describeTables(client);
    const table = `${SCHEMA}.items`;

    await expect(insertRow(client, tables, table, { "name\"; DROP TABLE x; --": "x" })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(updateRow(client, tables, table, { id: 999 }, { name: "x" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(deleteRow(client, tables, `${SCHEMA}.loose`, { note: "x" })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(insertRow(client, tables, table, { name: null })).rejects.toMatchObject({ code: "validation" });
    await expect(insertRow(client, tables, `${SCHEMA}.missing`, {})).rejects.toMatchObject({ code: "not_found" });
  });
});
