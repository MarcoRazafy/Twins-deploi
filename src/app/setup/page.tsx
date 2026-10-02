import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthSkeleton, SetupView } from "@/features/auth";

export const metadata: Metadata = { title: "Configuration initiale" };

export default function Page() {
  return (
    <Suspense fallback={<AuthSkeleton variant="setup" />}>
      <SetupView />
    </Suspense>
  );
}
