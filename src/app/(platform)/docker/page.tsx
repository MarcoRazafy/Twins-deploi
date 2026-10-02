import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { DockerView } from "@/features/docker";

export const metadata: Metadata = { title: "Docker" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton variant="table" />}>
      <DockerView />
    </Suspense>
  );
}
