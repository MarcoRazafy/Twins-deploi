import type { Api } from "@/lib/api/contract";

import type { Context } from "../context";
import { db } from "../db";
import { emit } from "../events";
import { toActivityEvent } from "../mappers/activity";
import { asRecord } from "../rules";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 300;

// Reads do not depend on the caller; the parameter keeps the create<Name>Api(ctx) convention.
export function createActivityApi(_ctx: Context): Api["activity"] {
  void _ctx;
  return {
    async list(rawFilter) {
      const filter = asRecord(rawFilter);
      const limit =
        typeof filter.limit === "number" && Number.isFinite(filter.limit)
          ? Math.min(MAX_LIMIT, Math.max(0, Math.floor(filter.limit)))
          : DEFAULT_LIMIT;
      if (limit === 0) return [];
      const rows = await db().activityEvent.findMany({
        where: {
          ...(typeof filter.projectId === "string" ? { projectId: filter.projectId } : {}),
          ...(filter.unreadOnly === true ? { read: false } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return rows.map(toActivityEvent);
    },

    async markRead(ids) {
      const wanted =
        ids === "all"
          ? null
          : Array.isArray(ids)
            ? ids.filter((id): id is string => typeof id === "string").slice(0, MAX_LIMIT)
            : [];
      if (wanted !== null && wanted.length === 0) return;
      const { count } = await db().activityEvent.updateMany({
        where: { read: false, ...(wanted === null ? {} : { id: { in: wanted } }) },
        data: { read: true },
      });
      if (count > 0) await emit(["activity"]);
    },
  };
}
