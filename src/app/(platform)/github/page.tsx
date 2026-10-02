import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { GithubView } from "@/features/github";

export const metadata: Metadata = { title: "GitHub" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <GithubView />
    </Suspense>
  );
}
