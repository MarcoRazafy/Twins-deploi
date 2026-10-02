import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { DomainsView } from "@/features/domains";

export const metadata: Metadata = { title: "Domaines" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DomainsView />
    </Suspense>
  );
}
