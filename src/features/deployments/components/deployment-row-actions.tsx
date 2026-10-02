"use client";

import Link from "next/link";
import { Ban, Ellipsis, History, RotateCw, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { routes } from "@/lib/routes";
import { canRollbackTo, isDeploymentInFlight } from "@/lib/status";
import type { Deployment } from "@/lib/types";

import type { DeploymentActions } from "../hooks/use-deployment-actions";

export interface DeploymentRowActionsProps {
  deployment: Deployment;
  actions: DeploymentActions;
  /** Adds the primary action as an inline button, revealed on row hover or focus. */
  showPrimary: boolean;
}

/** Row actions: the "…" menu is the complete set, the inline button is a shortcut. */
export function DeploymentRowActions({ deployment, actions, showPrimary }: DeploymentRowActionsProps) {
  const inFlight = isDeploymentInFlight(deployment.status);
  const rollbackable = canRollbackTo(deployment.status);

  const primary = inFlight
    ? { label: "Annuler", icon: Ban, run: () => actions.requestCancel(deployment) }
    : rollbackable
      ? { label: "Restaurer", icon: History, run: () => actions.requestRollback(deployment) }
      : {
          label: "Redéployer",
          icon: RotateCw,
          run: () => {
            void actions.redeploy(deployment);
          },
        };
  const PrimaryIcon = primary.icon;

  return (
    // Sits above the row's stretched link so both stay clickable.
    <div className="relative z-10 flex shrink-0 items-center gap-1">
      {showPrimary ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={actions.launching && !inFlight && !rollbackable}
          onClick={primary.run}
          // Fixed width: the label differs per status and would shift the columns of the row.
          className="hidden w-24 justify-center opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 @5xl:inline-flex [@media(hover:none)]:opacity-100"
        >
          <PrimaryIcon data-icon="inline-start" />
          {primary.label}
        </Button>
      ) : null}

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Actions du déploiement"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link href={`${routes.deployment(deployment.id)}#logs`}>
              <Terminal />
              Voir les logs
            </Link>
          </DropdownMenuItem>
          {inFlight ? null : (
            <DropdownMenuItem
              disabled={actions.launching}
              onSelect={() => {
                void actions.redeploy(deployment);
              }}
            >
              <RotateCw />
              Redéployer
            </DropdownMenuItem>
          )}
          {rollbackable ? (
            <DropdownMenuItem onSelect={() => actions.requestRollback(deployment)}>
              <History />
              Restaurer cette version
            </DropdownMenuItem>
          ) : null}
          {inFlight ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => actions.requestCancel(deployment)}
              >
                <Ban />
                Annuler
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
