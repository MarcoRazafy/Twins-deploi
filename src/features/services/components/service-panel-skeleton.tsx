import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the loaded panel: header, tab bar, content. */
export function ServicePanelSkeleton() {
  return (
    <div className="flex h-full flex-col bg-card @container" aria-busy="true" aria-label="Chargement du service">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3 @md:px-6 @md:pt-5">
        <Skeleton className="size-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-3.5 w-56 max-w-full" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-7 w-8 @md:w-24" />
          <Skeleton className="size-8" />
          <Skeleton className="size-8" />
        </div>
      </div>
      <div className="flex gap-5 border-b px-4 @md:px-6">
        {[88, 68, 76, 44, 68].map((width, index) => (
          <div key={index} className="flex h-10 items-center">
            <Skeleton className="h-4" style={{ width }} />
          </div>
        ))}
      </div>
      <div className="flex-1 space-y-4 p-4 @md:p-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  );
}
