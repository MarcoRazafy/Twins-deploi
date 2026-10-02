"use client";

import { ErrorState } from "@/components/shared/error-state";
import { isApiError } from "@/lib/api/contract";

/** Error boundary of the platform screens: the shell around it stays usable. */
export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
      <ErrorState
        title="Cette page a rencontré une erreur"
        // Only API errors carry a French, user-facing message.
        error={isApiError(error) ? error : undefined}
        onRetry={reset}
        className="w-full max-w-md"
      />
    </div>
  );
}
