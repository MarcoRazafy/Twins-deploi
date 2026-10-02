import type { Api } from "@/lib/api/contract";

import { emit } from "../emitter";
import { newestFirst } from "../text";
import { read, write } from "./respond";

const DEFAULT_LIMIT = 50;

export const activityApi: Api["activity"] = {
  list: (filter = {}) =>
    read((db) =>
      newestFirst(db.activity)
        .filter(
          (event) =>
            (filter.projectId === undefined || event.projectId === filter.projectId) &&
            (!filter.unreadOnly || !event.read),
        )
        .slice(0, Math.max(0, filter.limit ?? DEFAULT_LIMIT)),
    ),

  markRead: (ids) =>
    write((db) => {
      const wanted = ids === "all" ? null : new Set(ids);
      let changed = false;
      for (const event of db.activity) {
        if (!event.read && (wanted === null || wanted.has(event.id))) {
          event.read = true;
          changed = true;
        }
      }
      if (changed) emit(["activity"]);
    }),
};
