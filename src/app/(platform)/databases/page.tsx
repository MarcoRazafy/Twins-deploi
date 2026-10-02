import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { DatabasesView } from "@/features/databases";

export const metadata: Metadata = { title: "PostgreSQL" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DatabasesView />
    </Suspense>
  );
}
