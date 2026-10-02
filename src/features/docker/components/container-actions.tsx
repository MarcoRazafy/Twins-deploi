"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import {
  ExternalLink,
  MoreHorizontal,
  Play,
  RotateCw,
  ScrollText,
  Square,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { routes } from "@/lib/routes";
import type { Container, ContainerAction } from "@/lib/types";

import { canRestart, canStart, canStop } from "../lib/container-stats";

interface IconActionProps {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
}

function IconAction({ label, icon: Icon, onClick, loading, disabled }: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled || loading}
          onClick={onClick}
        >
          {loading ? <Spinner /> : <Icon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export interface ContainerActionsProps {
  container: Container;
  /** Action in flight on this row, if any. */
  busy: ContainerAction | undefined;
  onRun: (container: Container, action: ContainerAction) => void;
  onShowLogs: (container: Container) => void;
  onDelete: (container: Container) => void;
}

/** Inline icon buttons on wide screens, the same actions in a "…" menu everywhere. */
export function ContainerActions({
  container,
  busy,
  onRun,
  onShowLogs,
  onDelete,
}: ContainerActionsProps) {
  const { state } = container;
  const transient = state === "restarting";
  const locked = busy !== undefined || transient;
  const start = canStart(state);
  const stop = canStop(state);
  const restart = canRestart(state);

  return (
    <div className="flex items-center justify-end gap-0.5">
      <div className="hidden items-center gap-0.5 lg:flex">
        {start ? (
          <IconAction
            label="Démarrer"
            icon={Play}
            loading={busy === "start"}
            disabled={locked}
            onClick={() => onRun(container, "start")}
          />
        ) : (
          <IconAction
            label="Arrêter"
            icon={Square}
            loading={busy === "stop"}
            disabled={locked || !stop}
            onClick={() => onRun(container, "stop")}
          />
        )}
        <IconAction
          label="Redémarrer"
          icon={RotateCw}
          loading={busy === "restart"}
          disabled={locked || !restart}
          onClick={() => onRun(container, "restart")}
        />
        <IconAction
          label="Voir les logs"
          icon={ScrollText}
          loading={false}
          disabled={false}
          onClick={() => onShowLogs(container)}
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions de ${container.name}`}
          >
            {busy ? <Spinner /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {start ? (
            <DropdownMenuItem disabled={locked} onSelect={() => onRun(container, "start")}>
              <Play />
              Démarrer
            </DropdownMenuItem>
          ) : null}
          {stop ? (
            <DropdownMenuItem disabled={locked} onSelect={() => onRun(container, "stop")}>
              <Square />
              Arrêter
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={locked || !restart}
            onSelect={() => onRun(container, "restart")}
          >
            <RotateCw />
            Redémarrer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onShowLogs(container)}>
            <ScrollText />
            Voir les logs
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={routes.workspace(container.projectId, { service: container.serviceId })}>
              <ExternalLink />
              Ouvrir dans le workspace
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(container)}>
            <Trash2 />
            Supprimer le service
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
