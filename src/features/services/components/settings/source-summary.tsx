import type { Service } from "@/lib/types";

/** Read-only source of a PostgreSQL service. */
export function PostgresSourceSummary({ service }: { service: Service }) {
  if (service.source.type !== "postgres") return null;
  const { version } = service.source;

  return (
    <dl className="divide-y rounded-xl border bg-card text-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <dt className="text-muted-foreground">Version</dt>
        <dd className="font-medium">PostgreSQL {version}</dd>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <dt className="text-muted-foreground">Image</dt>
        <dd className="truncate font-mono text-[13px]">postgres:{version}</dd>
      </div>
    </dl>
  );
}
