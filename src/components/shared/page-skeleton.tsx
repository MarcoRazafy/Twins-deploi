import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const CONTAINER_SIZES = {
  overview: "max-w-[1400px]",
  table: "max-w-[1400px]",
  form: "max-w-4xl",
} as const;

export interface PageSkeletonProps {
  /**
   * Shape of the placeholder, matched to the page it stands for:
   * "overview" (KPI row + main block, the default), "table" (toolbar + rows)
   * or "form" (stacked settings sections, narrow).
   */
  variant?: keyof typeof CONTAINER_SIZES;
}

function TableRowsSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b p-3">
        <Skeleton className="h-8 w-full sm:w-64" />
        <Skeleton className="ml-auto hidden h-8 w-28 sm:block" />
      </div>
      <div className="divide-y">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="size-8 shrink-0 rounded-lg" />
            <Skeleton className="h-4 w-40 max-w-[40%]" />
            <Skeleton className="hidden h-4 w-24 md:block" />
            <Skeleton className="ml-auto h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Route-level fallback used by the `<Suspense>` boundary of each page. It
 * mirrors `<PageContainer>` + `<PageHeader>` so the real page replaces it
 * without a layout jump.
 */
export function PageSkeleton({ variant = "overview" }: PageSkeletonProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8",
        CONTAINER_SIZES[variant],
      )}
      aria-busy="true"
      aria-label="Chargement"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48 sm:h-8" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>

      {variant === "overview" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-32 rounded-xl sm:h-[136px]" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </>
      ) : null}

      {variant === "table" ? <TableRowsSkeleton /> : null}

      {variant === "form"
        ? Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
              <Skeleton className="h-8 w-full max-w-md" />
              <Skeleton className="h-8 w-full max-w-md" />
            </div>
          ))
        : null}
    </div>
  );
}
