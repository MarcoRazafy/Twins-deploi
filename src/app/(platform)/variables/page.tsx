import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { VariablesView } from "@/features/variables";

export const metadata: Metadata = { title: "Variables" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton variant="table" />}>
      <VariablesView />
    </Suspense>
  );
}
