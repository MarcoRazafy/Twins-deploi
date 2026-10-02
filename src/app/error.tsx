"use client";

import { ErrorState } from "@/components/shared/error-state";
import { isApiError } from "@/lib/api/contract";

/** Last-resort error boundary, outside the platform shell. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <ErrorState
        title="Une erreur est survenue"
        // Only API errors carry a French, user-facing message.
        error={isApiError(error) ? error : undefined}
        onRetry={reset}
        className="w-full max-w-md"
      />
    </main>
  );
}
