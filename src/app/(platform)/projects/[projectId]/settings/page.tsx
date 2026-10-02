import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { ProjectSettingsView } from "@/features/projects";

export const metadata: Metadata = { title: "Réglages du projet" };

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <Suspense fallback={<PageSkeleton variant="form" />}>
      <ProjectSettingsView projectId={projectId} />
    </Suspense>
  );
}
