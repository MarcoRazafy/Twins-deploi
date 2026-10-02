import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { WorkspaceView } from "@/features/workspace";

export const metadata: Metadata = { title: "Workspace" };

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkspaceView projectId={projectId} />
    </Suspense>
  );
}
