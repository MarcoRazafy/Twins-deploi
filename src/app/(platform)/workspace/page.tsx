import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { WorkspaceIndexView } from "@/features/workspace";

export const metadata: Metadata = { title: "Workspace" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkspaceIndexView />
    </Suspense>
  );
}
