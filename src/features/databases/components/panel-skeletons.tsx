import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Geometry of a <SectionCard>: a header, then a body of the given height. */
function SectionCardSkeleton({ bodyClassName }: { bodyClassName?: string }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="space-y-2 p-4 sm:p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <Skeleton className={cn("h-8 w-full", bodyClassName)} />
      </div>
    </div>
  );
}

function Busy({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true" className="space-y-4">
      <p role="status" className="sr-only">
        {label}
      </p>
      {children}
    </div>
  );
}

export function ConnectionSkeleton() {
  return (
    <Busy label="Chargement de la connexion…">
      <SectionCardSkeleton />
      <SectionCardSkeleton />
      <SectionCardSkeleton bodyClassName="h-24" />
      <SectionCardSkeleton bodyClassName="h-32" />
    </Busy>
  );
}

export function SettingsSkeleton() {
  return (
    <Busy label="Chargement des réglages…">
      <SectionCardSkeleton bodyClassName="h-20" />
      <SectionCardSkeleton />
      <SectionCardSkeleton bodyClassName="h-0" />
      <SectionCardSkeleton bodyClassName="h-0" />
    </Busy>
  );
}

export function BackupsSkeleton() {
  return (
    <Busy label="Chargement des sauvegardes…">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="divide-y rounded-xl border bg-card">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-4 w-40 max-w-full" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="size-8 rounded-lg" />
          </div>
        ))}
      </div>
    </Busy>
  );
}

export function DataPanelSkeleton() {
  return (
    <Busy label="Chargement des données…">
      <Skeleton className="h-9 w-56 rounded-lg" />
      <TablesSkeleton />
    </Busy>
  );
}

/** List of tables on the left, grid on the right (select above the grid when narrow). */
export function TablesSkeleton() {
  return (
    <div className="grid gap-4 @xl:grid-cols-[15rem_minmax(0,1fr)] @xl:items-start">
      <Skeleton className="h-8 w-full rounded-lg @xl:hidden" />
      <div className="space-y-2 rounded-xl border bg-card p-3 @max-xl:hidden">
        <Skeleton className="h-8 w-full rounded-lg" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-lg" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    </div>
  );
}
