"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";

import { ErrorState } from "@/components/shared/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useVariables } from "@/lib/queries";
import { routes } from "@/lib/routes";

import { VariableValue } from "./variable-row";

export interface InheritedVariablesProps {
  projectId: string;
  /** Keys the service defines itself: the shared value is not the one it receives. */
  overriddenKeys: ReadonlySet<string>;
}

/**
 * The project's shared variables, read-only, as a service inherits them. The
 * link leads to the shared scope of the Variables page for editing.
 */
export function InheritedVariables({ projectId, overriddenKeys }: InheritedVariablesProps) {
  const [open, setOpen] = useState(false);
  const shared = useVariables({ projectId, serviceId: null });
  const variables = shared.data;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 pr-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group/trigger flex min-w-0 flex-1 items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/trigger:rotate-90"
            />
            <span className="truncate">Variables partagées héritées</span>
            {variables ? (
              <Badge variant="secondary" className="tabular">
                {variables.length}
              </Badge>
            ) : null}
          </button>
        </CollapsibleTrigger>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link href={routes.variables({ project: projectId })}>
            Gérer
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      <CollapsibleContent className="border-t data-[state=open]:animate-in data-[state=open]:fade-in-0">
        {shared.isPending ? (
          <div aria-busy="true" className="divide-y">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ) : !variables ? (
          <ErrorState compact title="Variables partagées indisponibles" error={shared.error} onRetry={() => void shared.refetch()} />
        ) : variables.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            Aucune variable partagée dans ce projet.
          </p>
        ) : (
          <ul className="divide-y">
            {variables.map((variable) => (
              <li
                key={variable.id}
                className="grid grid-cols-[minmax(0,1fr)] gap-1 px-4 py-2.5 @xl:grid-cols-[minmax(0,34%)_minmax(0,1fr)_auto] @xl:items-center @xl:gap-4"
              >
                <span
                  title={variable.key}
                  className="min-w-0 truncate font-mono text-[13px] font-medium"
                >
                  {variable.key}
                </span>
                <VariableValue variable={variable} />
                {overriddenKeys.has(variable.key) ? (
                  <Badge variant="outline" className="w-fit text-muted-foreground">
                    Remplacée par ce service
                  </Badge>
                ) : (
                  <span aria-hidden="true" className="hidden @xl:block" />
                )}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
