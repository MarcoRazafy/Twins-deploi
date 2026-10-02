"use client";

import { useId, type ReactNode } from "react";
import { motion } from "motion/react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: ReactNode;
}

interface SegmentedProps<Value extends string> {
  value: Value;
  onValueChange: (value: Value) => void;
  options: ReadonlyArray<SegmentedOption<Value>>;
  /** Accessible name of the group. */
  label: string;
  className?: string;
}

/** Single choice among a few options; the highlight glides between them. */
export function Segmented<Value extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: SegmentedProps<Value>) {
  const indicatorId = useId();

  return (
    <ToggleGroup
      type="single"
      value={value}
      spacing={1}
      aria-label={label}
      onValueChange={(next) => {
        // Radix reports "" when the pressed item is pressed again: keep the choice.
        const match = options.find((option) => option.value === next);
        if (match) onValueChange(match.value);
      }}
      className={cn("rounded-lg border bg-secondary/40 p-0.5", className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="relative flex-1 rounded-md px-3 text-muted-foreground hover:bg-transparent hover:text-foreground aria-checked:bg-transparent data-[state=on]:bg-transparent data-[state=on]:text-foreground"
        >
          {option.value === value ? (
            <motion.span
              layoutId={indicatorId}
              aria-hidden="true"
              className="absolute inset-0 rounded-md bg-accent"
              transition={SPRING.snappy}
            />
          ) : null}
          <span className="relative z-10">{option.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
