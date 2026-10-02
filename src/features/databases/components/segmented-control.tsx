"use client";

import { useId, type ReactNode } from "react";
import { motion } from "motion/react";

import type { IconComponent } from "@/components/shared/render-icon";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: ReactNode;
  icon?: IconComponent;
  /** Accessible name when the label alone does not say enough. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<Value extends string> {
  value: Value;
  onValueChange: (value: Value) => void;
  options: ReadonlyArray<SegmentedOption<Value>>;
  /** Accessible name of the group. */
  label: string;
  size?: "default" | "sm";
  disabled?: boolean;
  className?: string;
}

/**
 * Single choice among a few options (version, view mode, time range). The
 * highlight is a shared-layout pill that glides from one option to the next.
 */
export function SegmentedControl<Value extends string>({
  value,
  onValueChange,
  options,
  label,
  size = "default",
  disabled,
  className,
}: SegmentedControlProps<Value>) {
  const indicatorId = useId();

  return (
    <ToggleGroup
      type="single"
      value={value}
      size={size}
      spacing={1}
      disabled={disabled}
      aria-label={label}
      onValueChange={(next) => {
        // Radix reports "" when the pressed item is pressed again: keep the choice.
        const match = options.find((option) => option.value === next);
        if (match) onValueChange(match.value);
      }}
      className={cn("rounded-lg border bg-secondary/40 p-0.5", className)}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon, ariaLabel }) => {
        const selected = optionValue === value;
        return (
          <ToggleGroupItem
            key={optionValue}
            value={optionValue}
            aria-label={ariaLabel}
            className={cn(
              "relative flex-1 rounded-md px-3 text-muted-foreground hover:bg-transparent hover:text-foreground aria-checked:bg-transparent data-[state=on]:bg-transparent data-[state=on]:text-foreground",
              size === "sm" && "px-2.5",
            )}
          >
            {selected ? (
              <motion.span
                layoutId={indicatorId}
                aria-hidden="true"
                className="absolute inset-0 rounded-md bg-accent"
                transition={SPRING.snappy}
              />
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon ? <Icon className="size-3.5" /> : null}
              {optionLabel}
            </span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
