"use client";

import { useState, type ComponentProps, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ButtonProps = ComponentProps<typeof Button>;

export interface CopyButtonProps {
  /** Text placed on the clipboard. */
  value: string;
  /**
   * With a label the button shows text ("Copier l’URL"); without one it is
   * icon-only and explains itself with a tooltip.
   */
  label?: string;
  /** Defaults to "icon-sm" (icon-only) or "sm" (with a label). */
  size?: ButtonProps["size"];
  /** Defaults to "ghost" (icon-only) or "outline" (with a label). */
  variant?: ButtonProps["variant"];
  className?: string;
  /** Tooltip and accessible name of the icon-only button (default "Copier"). */
  tooltip?: string;
  /** Called after each attempt, e.g. to toast when the copy failed. */
  onCopy?: (succeeded: boolean) => void;
}

/** Copy icon that morphs into a check mark while `copied`. */
function CopyGlyph({
  copied,
  inline = false,
  className,
}: {
  copied: boolean;
  /** Set when a label follows, so the button trims its leading padding. */
  inline?: boolean;
  className?: string;
}) {
  return (
    <span
      data-icon={inline ? "inline-start" : undefined}
      className="inline-grid place-items-center"
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={copied ? "copied" : "copy"}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ duration: DURATION.fast, ease: EASE.out }}
          className="inline-flex [grid-area:1/1]"
        >
          {copied ? (
            <Check className={cn("text-success", className)} />
          ) : (
            <Copy className={className} />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function CopyButton({
  value,
  label,
  size,
  variant,
  className,
  tooltip = "Copier",
  onCopy,
}: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard();
  const [hovered, setHovered] = useState(false);

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // The button often lives in a clickable row, a link or a label.
    event.preventDefault();
    event.stopPropagation();
    const succeeded = await copy(value);
    onCopy?.(succeeded);
  }

  const announcement = (
    <span role="status" className="sr-only">
      {copied ? "Copié dans le presse-papiers" : ""}
    </span>
  );

  const resolvedSize = size ?? (label ? "sm" : "icon-sm");

  if (label) {
    return (
      <>
        <Button
          type="button"
          variant={variant ?? "outline"}
          size={resolvedSize}
          className={className}
          onClick={handleClick}
        >
          <CopyGlyph copied={copied} inline />
          {/* Both labels share one cell so the width never changes. */}
          <span className="inline-grid">
            <span className={cn("[grid-area:1/1]", copied && "invisible")}>{label}</span>
            <span className={cn("[grid-area:1/1]", !copied && "invisible")}>Copié</span>
          </span>
        </Button>
        {announcement}
      </>
    );
  }

  return (
    <>
      {/* Radix closes a tooltip on click: keep it open to confirm the copy. */}
      <Tooltip open={hovered || copied} onOpenChange={setHovered}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={variant ?? "ghost"}
            size={resolvedSize}
            aria-label={tooltip}
            className={cn("text-muted-foreground hover:text-foreground", className)}
            onClick={handleClick}
          >
            {/* 12 px (the icon-xs default) is too faint for a glyph that morphs. */}
            <CopyGlyph
              copied={copied}
              className={resolvedSize === "icon-xs" ? "size-3.5" : undefined}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copié" : tooltip}</TooltipContent>
      </Tooltip>
      {announcement}
    </>
  );
}
