import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";

import { KitView } from "./_components/kit-view";

export const metadata: Metadata = { title: "Kit UI" };

// KitView reads `?section=` through useSearchParams, hence the boundary.
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KitView />
    </Suspense>
  );
}
