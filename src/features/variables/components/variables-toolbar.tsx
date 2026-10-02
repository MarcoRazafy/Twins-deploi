"use client";

import { Eye, EyeOff, FileCode, Plus, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { CopyButton } from "@/components/shared/copy-button";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const COPY_LABEL = "Copier en .env";

interface ToolbarButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}

/** Icon button that shows its label once the container is wide enough (`3xl`). */
function ToolbarButton({ icon: Icon, label, onClick, pressed, disabled }: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          className="@max-3xl:w-7 @max-3xl:px-0 pointer-coarse:h-10 pointer-coarse:@max-3xl:w-10"
          onClick={onClick}
        >
          <Icon />
          <span className="hidden @3xl:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function handleCopy(succeeded: boolean) {
  if (!succeeded) toast.error("Impossible de copier dans le presse-papiers");
}

export interface VariablesToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  revealAll: boolean;
  onToggleReveal: () => void;
  /** Nothing to reveal without a secret. */
  hasSecrets: boolean;
  /** The whole scope as KEY=value lines. */
  envText: string;
  /** The add form is open: the primary button waits for it to close. */
  formOpen: boolean;
  onNew: () => void;
  onOpenRaw: () => void;
}

/**
 * Content of the table card's toolbar row. The container decides the shape:
 * search and primary button first, the three tools as icons between them, and
 * labelled tools from the `3xl` container width.
 */
export function VariablesToolbar({
  search,
  onSearchChange,
  revealAll,
  onToggleReveal,
  hasSecrets,
  envText,
  formOpen,
  onNew,
  onOpenRaw,
}: VariablesToolbarProps) {
  return (
    <>
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="Rechercher une variable…"
        label="Rechercher une variable"
        className="min-w-0 flex-1 basis-full @md:basis-40"
      />
      <div className="flex items-center gap-2">
        <ToolbarButton
          icon={revealAll ? EyeOff : Eye}
          label={revealAll ? "Tout masquer" : "Tout afficher"}
          pressed={revealAll}
          disabled={!hasSecrets}
          onClick={onToggleReveal}
        />
        <ToolbarButton icon={FileCode} label="Éditeur brut" onClick={onOpenRaw} />
        {/* CopyButton cannot hide its label, so each width gets its own variant. */}
        <span className="contents @3xl:hidden">
          <CopyButton
            value={envText}
            variant="outline"
            size="icon-sm"
            className="pointer-coarse:size-10"
            tooltip={COPY_LABEL}
            onCopy={handleCopy}
          />
        </span>
        <span className="hidden @3xl:contents">
          <CopyButton
            value={envText}
            variant="outline"
            size="sm"
            className="pointer-coarse:h-10"
            label={COPY_LABEL}
            onCopy={handleCopy}
          />
        </span>
      </div>
      <Button type="button" size="sm" disabled={formOpen} className="ml-auto pointer-coarse:h-10 @md:ml-0" onClick={onNew}>
        <Plus data-icon="inline-start" />
        Nouvelle variable
      </Button>
    </>
  );
}
