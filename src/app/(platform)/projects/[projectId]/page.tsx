import type { Metadata } from "next";
import { Suspense } from "react";

import { WorkspaceView, WorkspaceSkeleton } from "@/features/workspace";

export const metadata: Metadata = { title: "Workspace" };

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <WorkspaceView projectId={projectId} />
    </Suspense>
  );
}
