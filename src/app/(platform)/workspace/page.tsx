import type { Metadata } from "next";
import { Suspense } from "react";

import { WorkspaceIndexView, WorkspaceSkeleton } from "@/features/workspace";

export const metadata: Metadata = { title: "Workspace" };

export default function Page() {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <WorkspaceIndexView />
    </Suspense>
  );
}
