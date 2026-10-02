import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { DeploymentDetailView } from "@/features/deployments";

export const metadata: Metadata = { title: "Déploiement" };

export default async function Page({
  params,
}: {
  params: Promise<{ deploymentId: string }>;
}) {
  const { deploymentId } = await params;

  return (
    <Suspense fallback={<PageSkeleton />}>
      <DeploymentDetailView deploymentId={deploymentId} />
    </Suspense>
  );
}
