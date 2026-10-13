import { describe, expect, it, vi } from "vitest";

// The entry needs the real backend: the simulator (default mode of the tests) hides it.
vi.mock("@/lib/api", () => ({ API_MODE: "http" }));

import { isNavItemVisible, NAV_ITEMS, resolveRouteContext } from "@/components/layout/nav-config";
import { routes } from "@/lib/routes";
import { getActivityHref } from "@/features/dashboard/lib/activity-links";
import type { ActivityEvent } from "@/lib/types";

const consoleItem = NAV_ITEMS.find((item) => item.id === "server-console");

describe("sidebar entry of the server console", () => {
  it("exists, points to /console and is named in the top bar", () => {
    expect(consoleItem).toMatchObject({ label: "Console", href: "/console", backendOnly: true });
    expect(consoleItem?.isActive("/console")).toBe(true);
    expect(consoleItem?.isActive("/databases/db_1")).toBe(false);
    expect(resolveRouteContext("/console")).toEqual({ kind: "page", title: "Console" });
  });

  it("is shown to the owner only", () => {
    expect(isNavItemVisible(consoleItem!, "owner")).toBe(true);
    for (const role of ["admin", "developer", "viewer", null] as const) {
      expect(isNavItemVisible(consoleItem!, role)).toBe(false);
    }
  });

  it("is reachable from the journal: console events lead to its settings", () => {
    const event = { type: "console.opened", projectId: null, serviceId: null, deploymentId: null } as ActivityEvent;
    expect(getActivityHref(event)).toBe(routes.settings("console"));
  });
});
