import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { DeploymentsView } from "@/features/deployments";

export const metadata: Metadata = { title: "Déploiements" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton variant="table" />}>
      <DeploymentsView />
    </Suspense>
  );
}
