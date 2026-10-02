"use client";

import { useId } from "react";
import { motion } from "motion/react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SPRING } from "@/lib/motion";

import {
  isStatusFilterKey,
  STATUS_FILTER_KEYS,
  STATUS_FILTERS,
  type StatusFilterKey,
} from "../lib/deployment-utils";

export interface StatusFilterChipsProps {
  value: StatusFilterKey;
  onChange: (value: StatusFilterKey) => void;
}

/** Single-choice status chips; the highlight slides from one chip to the next. */
export function StatusFilterChips({ value, onChange }: StatusFilterChipsProps) {
  const indicatorId = useId();

  return (
    <div className="-mx-4 -my-1 overflow-x-auto px-4 py-1 sm:mx-0 sm:px-0">
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next) => {
          // Clicking the active chip would clear the group: one chip is always on.
          if (isStatusFilterKey(next)) onChange(next);
        }}
        aria-label="Filtrer par statut"
        spacing={2}
        className="w-max"
      >
        {STATUS_FILTER_KEYS.map((key) => (
          <ToggleGroupItem
            key={key}
            value={key}
            className="relative rounded-full px-3 text-muted-foreground hover:bg-secondary/50 hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground data-[state=on]:hover:bg-transparent"
          >
            {key === value ? (
              <motion.span
                layoutId={indicatorId}
                transition={SPRING.snappy}
                aria-hidden="true"
                className="absolute inset-0 rounded-full border border-border-strong bg-secondary"
              />
            ) : null}
            <span className="relative">{STATUS_FILTERS[key].label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
