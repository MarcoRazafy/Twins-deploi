import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { DatabaseDetailView } from "@/features/databases";

export const metadata: Metadata = { title: "Base de données" };

export default async function Page({
  params,
}: {
  params: Promise<{ databaseId: string }>;
}) {
  const { databaseId } = await params;

  return (
    <Suspense fallback={<PageSkeleton />}>
      <DatabaseDetailView databaseId={databaseId} />
    </Suspense>
  );
}
