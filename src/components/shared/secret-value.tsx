"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { CopyButton } from "@/components/shared/copy-button";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Fixed length: the mask must not reveal how long the secret is.
const MASK = "•".repeat(12);

export interface SecretValueProps {
  value: string;
  className?: string;
  /** Adds a copy button (default true). Copy works while the value is masked. */
  copyable?: boolean;
}

/**
 * Inline secret (table cells, variable rows): masked by default, with an eye
 * toggle and a copy button.
 */
export function SecretValue({ value, className, copyable = true }: SecretValueProps) {
  const [revealed, setRevealed] = useState(false);
  const toggleLabel = revealed ? "Masquer la valeur" : "Afficher la valeur";

  return (
    <span className={cn("inline-flex max-w-full min-w-0 items-center gap-0.5", className)}>
      <span
        title={revealed ? value : undefined}
        className={cn(
          "mr-1 min-w-0 truncate font-mono text-[13px]",
          !revealed && "tracking-wider text-muted-foreground select-none",
        )}
      >
        {revealed ? value : MASK}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={toggleLabel}
            aria-pressed={revealed}
            className="text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              setRevealed((current) => !current);
            }}
          >
            {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{toggleLabel}</TooltipContent>
      </Tooltip>
      {copyable ? <CopyButton value={value} size="icon-xs" /> : null}
    </span>
  );
}
