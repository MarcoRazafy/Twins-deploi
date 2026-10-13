import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { ServerConsoleView } from "@/features/server-console";

export const metadata: Metadata = { title: "Console" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton variant="table" />}>
      <ServerConsoleView />
    </Suspense>
  );
}
