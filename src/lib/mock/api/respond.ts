import { getDb, save } from "../db";
import { latency } from "../latency";
import type { MockDb } from "../schema";

/**
 * Every API method goes through one of these: wait like a network call, run
 * against the database, and hand back a deep copy so callers can never reach
 * (or mutate) the stored records.
 */
export async function read<T>(run: (db: MockDb) => T): Promise<T> {
  await latency.read();
  return structuredClone(run(getDb()));
}

export async function write<T>(run: (db: MockDb) => T): Promise<T> {
  await latency.write();
  const result = run(getDb());
  save();
  return structuredClone(result);
}

/** Same as `write`, without the artificial latency. */
export async function writeNow<T>(run: (db: MockDb) => T): Promise<T> {
  const result = run(getDb());
  save();
  return structuredClone(result);
}
