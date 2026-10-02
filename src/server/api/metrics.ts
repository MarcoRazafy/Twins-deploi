import type { Api } from "@/lib/api/contract";

import { requireUser, type Context } from "../context";
import { getOverview } from "../metrics/overview";
import { getServiceMetrics } from "../metrics/service";
import { asString } from "../rules";

export function createMetricsApi(ctx: Context): Api["metrics"] {
  // Access levels are enforced by the route (viewer); this keeps the namespace
  // unusable without a signed-in user when it is called directly.
  return {
    async getServiceMetrics(serviceId, range) {
      requireUser(ctx);
      return getServiceMetrics(asString(serviceId), range);
    },

    async getOverview() {
      requireUser(ctx);
      return getOverview();
    },
  };
}
