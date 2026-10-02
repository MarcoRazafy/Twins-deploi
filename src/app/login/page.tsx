import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthSkeleton, LoginView } from "@/features/auth";

export const metadata: Metadata = { title: "Connexion" };

export default function Page() {
  return (
    <Suspense fallback={<AuthSkeleton variant="login" />}>
      <LoginView />
    </Suspense>
  );
}
