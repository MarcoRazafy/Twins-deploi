"use client";

import { useId } from "react";
import { motion } from "motion/react";

import { renderIcon, type IconComponent } from "@/components/shared/render-icon";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
  icon?: IconComponent;
}

export interface SegmentedControlProps<Value extends string> {
  value: Value;
  onValueChange: (value: Value) => void;
  options: ReadonlyArray<SegmentedOption<Value>>;
  /** Accessible name of the group. */
  label: string;
  disabled?: boolean;
  /** Sets the width (default: as wide as its labels). */
  className?: string;
}

/**
 * Compact single-choice control (filters, builder). The highlight is one
 * shared element that glides from option to option.
 */
export function SegmentedControl<Value extends string>({
  value,
  onValueChange,
  options,
  label,
  disabled,
  className,
}: SegmentedControlProps<Value>) {
  const highlightId = useId();

  function handleChange(next: string) {
    // Radix reports "" when the active option is pressed again: a segmented
    // control always keeps one value.
    const option = options.find((candidate) => candidate.value === next);
    if (option) onValueChange(option.value);
  }

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={handleChange}
      spacing={0}
      disabled={disabled}
      aria-label={label}
      className={cn("h-8 w-fit rounded-lg border bg-secondary/40 p-0.5", className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="relative h-7 flex-auto shrink-0 rounded-md! px-3 text-[0.8rem] text-muted-foreground hover:bg-transparent! hover:text-foreground data-[state=on]:bg-transparent! data-[state=on]:text-foreground"
        >
          {option.value === value ? (
            <motion.span
              layoutId={highlightId}
              transition={SPRING.snappy}
              className="absolute inset-0 rounded-md border border-border-strong bg-accent"
            />
          ) : null}
          <span className="relative inline-flex items-center gap-1.5">
            {renderIcon(option.icon, "size-3.5")}
            {option.label}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
