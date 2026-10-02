import { Hammer } from "lucide-react";

/**
 * Temporary stand-in rendered by feature stubs until the real feature lands.
 * Delete once no feature imports it.
 */
export function FeaturePlaceholder({ name }: { name: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong p-6 text-center text-muted-foreground">
      <Hammer className="size-5" />
      <p className="text-sm font-medium text-foreground">{name}</p>
      <p className="text-xs">En cours de construction</p>
    </div>
  );
}
