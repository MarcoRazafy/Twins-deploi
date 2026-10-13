import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/page-skeleton";
import { ClaudeCodeView } from "@/features/claude-code";

export const metadata: Metadata = { title: "Claude Code" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton variant="table" />}>
      <ClaudeCodeView />
    </Suspense>
  );
}
