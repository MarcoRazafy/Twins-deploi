import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";

import { ServicePanelHarness } from "./service-panel-harness";

export const metadata: Metadata = { title: "Panneau de service" };

// The harness reads ?project=, ?service= and ?tab= through useSearchParams, hence the boundary.
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ServicePanelHarness />
    </Suspense>
  );
}
