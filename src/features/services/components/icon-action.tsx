"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface IconActionProps extends Omit<ComponentProps<typeof Button>, "aria-label"> {
  /** Accessible name and tooltip. */
  label: string;
}

/** Icon-only button with its tooltip (DESIGN.md §6). */
export function IconAction({ label, size = "icon-sm", variant = "ghost", ...props }: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size={size} variant={variant} aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
