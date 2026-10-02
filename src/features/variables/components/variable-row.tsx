"use client";

import { Copy, Ellipsis, Eye, EyeOff, Link2, Lock, Pencil, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { CopyButton } from "@/components/shared/copy-button";
import { RelativeTime } from "@/components/shared/relative-time";
import { SecretValue } from "@/components/shared/secret-value";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getErrorMessage } from "@/lib/api/contract";
import { DURATION, EASE, SPRING, STAGGER } from "@/lib/motion";
import type { EnvVariable } from "@/lib/types";

import type { VariableActions } from "../hooks/use-variable-actions";
import { describeReference, findReferences } from "../lib/env";

function ReferenceBadge({ value }: { value: string }) {
  const references = findReferences(value);
  if (references.length === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          tabIndex={0}
          variant="outline"
          className="border-brand-600/25 bg-brand-600/10 text-brand-400"
        >
          <Link2 />
          Référence
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-start gap-0.5">
        <span className="font-medium">Résolue au déploiement</span>
        {references.map((reference, index) => (
          <span key={`${reference.raw}-${index}`}>{describeReference(reference)}</span>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

export interface VariableValueProps {
  variable: Pick<EnvVariable, "value" | "isSecret">;
  /** The toolbar's "Tout afficher": sealed values are shown in clear. */
  revealAll?: boolean;
}

/** Value cell: reference badge, then the masked secret or the plain value. */
export function VariableValue({ variable, revealAll = false }: VariableValueProps) {
  const { value, isSecret } = variable;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <ReferenceBadge value={value} />
      {isSecret && !revealAll ? (
        <SecretValue value={value} />
      ) : (
        <span className="inline-flex max-w-full min-w-0 items-center gap-0.5">
          {value === "" ? (
            <span className="text-sm text-muted-foreground italic">Vide</span>
          ) : (
            <span title={value} className="mr-1 min-w-0 truncate font-mono text-[13px]">
              {value}
            </span>
          )}
          {isSecret ? <CopyButton value={value} size="icon-xs" /> : null}
        </span>
      )}
    </div>
  );
}

export interface VariableRowProps {
  variable: EnvVariable;
  /** Position in the list, only used to stagger the entrance of the first rows. */
  index: number;
  revealAll: boolean;
  actions: VariableActions;
  onEdit: (variable: EnvVariable) => void;
  onDelete: (variable: EnvVariable) => void;
}

/**
 * One variable. Below the `xl` container width the row becomes a two-line
 * grid (name above value, actions on the right) and the date column goes away.
 */
export function VariableRow({
  variable,
  index,
  revealAll,
  actions,
  onEdit,
  onDelete,
}: VariableRowProps) {
  const { copy } = useCopyToClipboard();

  async function copyText(text: string, message: string) {
    if (await copy(text)) toast.success(message);
    else toast.error("Impossible de copier dans le presse-papiers");
  }

  async function toggleSecret() {
    try {
      await actions.toggleSecret(variable);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <motion.tr
      layout="position"
      data-slot="table-row"
      initial={{ opacity: 0, y: 6 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: {
          duration: DURATION.base,
          ease: EASE.out,
          delay: Math.min(index, STAGGER.maxItems) * STAGGER.step,
        },
      }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE.out } }}
      transition={{ layout: SPRING.smooth }}
      className="group/row border-b transition-colors @max-xl:grid @max-xl:grid-cols-[minmax(0,1fr)_auto] @max-xl:items-center @max-xl:gap-x-2 @max-xl:gap-y-1.5 @max-xl:px-4 @max-xl:py-3"
    >
      <TableCell className="w-[34%] @max-xl:w-auto @max-xl:p-0! @max-xl:[grid-area:1/1]">
        <div className="flex min-w-0 items-center gap-1.5">
          {variable.isSecret ? (
            <Lock
              role="img"
              aria-label="Secret"
              className="size-3 shrink-0 text-muted-foreground"
            />
          ) : null}
          <span title={variable.key} className="min-w-0 truncate font-mono text-[13px] font-medium">
            {variable.key}
          </span>
          <CopyButton
            value={variable.key}
            size="icon-xs"
            tooltip="Copier le nom"
            className="shrink-0 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:hidden"
          />
        </div>
      </TableCell>

      <TableCell className="@max-xl:p-0! @max-xl:[grid-area:2/1]">
        <VariableValue variable={variable} revealAll={revealAll} />
      </TableCell>

      <TableCell className="hidden w-32 @xl:table-cell">
        <RelativeTime date={variable.updatedAt} className="text-xs text-muted-foreground" />
      </TableCell>

      <TableCell className="w-14 @max-xl:p-0! @max-xl:[grid-area:1/2/3/3]">
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="pointer-coarse:size-9"
                aria-label={`Actions de ${variable.key}`}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => onEdit(variable)}>
                <Pencil />
                Modifier
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void toggleSecret()}>
                {variable.isSecret ? <Eye /> : <EyeOff />}
                {variable.isSecret ? "Retirer le secret" : "Marquer comme secret"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyText(variable.value, "Valeur copiée")}>
                <Copy />
                Copier la valeur
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyText(variable.key, "Nom copié")}>
                <Copy />
                Copier le nom
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(variable)}>
                <Trash2 />
                Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </motion.tr>
  );
}
