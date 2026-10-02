import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { ProjectsView } from "@/features/projects";

export const metadata: Metadata = { title: "Projets" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton variant="table" />}>
      <ProjectsView />
    </Suspense>
  );
}
