"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { CopyButton } from "@/components/shared/copy-button";
import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useBuiltinVariables } from "@/lib/queries";

export interface BuiltinVariablesProps {
  serviceId: string;
  serviceName: string;
}

/**
 * PORT and the TWINS_* variables the platform hands to the container of a
 * service, read-only. Another service reaches them with
 * `${{<service>.TWINS_PUBLIC_DOMAIN}}`.
 */
export function BuiltinVariables({ serviceId, serviceName }: BuiltinVariablesProps) {
  const [open, setOpen] = useState(false);
  const query = useBuiltinVariables(serviceId);
  const variables = query.data;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group/trigger flex w-full min-w-0 items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/trigger:rotate-90"
          />
          <span className="truncate">Variables fournies par la plateforme</span>
          {variables ? (
            <Badge variant="secondary" className="tabular">
              {variables.length}
            </Badge>
          ) : null}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="border-t data-[state=open]:animate-in data-[state=open]:fade-in-0">
        <p className="px-4 pt-3 pb-2 text-sm text-muted-foreground">
          Ajoutées automatiquement au conteneur à chaque déploiement, en lecture seule. Depuis un autre
          service du projet : <code className="font-mono text-[12px]">{`\${{${serviceName}.TWINS_PUBLIC_DOMAIN}}`}</code>.
        </p>
        {query.isPending ? (
          <div aria-busy="true" className="divide-y">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ) : !variables ? (
          <ErrorState compact title="Variables de la plateforme indisponibles" error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <ul className="divide-y">
            {variables.map((variable) => (
              <li
                key={variable.key}
                className="grid grid-cols-[minmax(0,1fr)] gap-1 px-4 py-2.5 @xl:grid-cols-[minmax(0,34%)_minmax(0,1fr)_auto] @xl:items-center @xl:gap-4"
              >
                <div className="min-w-0">
                  <span title={variable.key} className="block truncate font-mono text-[13px] font-medium">
                    {variable.key}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground" title={variable.description}>
                    {variable.description}
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {variable.value === "" ? (
                    <span className="text-sm text-muted-foreground italic">vide</span>
                  ) : (
                    <span className="min-w-0 truncate font-mono text-[13px]" title={variable.value}>
                      {variable.value}
                    </span>
                  )}
                  {variable.value !== "" ? <CopyButton value={variable.value} size="icon-xs" /> : null}
                </div>
                <CopyButton value={`\${{${serviceName}.${variable.key}}}`} label="Copier la référence" size="sm" variant="ghost" />
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
