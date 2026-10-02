"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";

import { SPRING } from "@/lib/motion";
import type { SettingsSection } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { SECTION_META } from "../lib/sections";

interface SettingsNavProps {
  value: SettingsSection;
  onChange: (value: SettingsSection) => void;
}

/** Sticky column on desktop, horizontally scrollable strip on small screens. */
export function SettingsNav({ value, onChange }: SettingsNavProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Keeps the active tab visible when the page opens on a section far along the strip.
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [value]);

  return (
    <nav aria-label="Sections des Settings" className="lg:sticky lg:top-6 lg:self-start">
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden">
        {SECTION_META.map((section) => {
          const active = section.value === value;
          const Icon = section.icon;
          return (
            <li key={section.value} className="shrink-0">
              <button
                ref={active ? activeRef : undefined}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onChange(section.value)}
                className={cn(
                  "relative flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 lg:min-h-9",
                  active ? "text-foreground" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="settings-nav-indicator"
                    transition={SPRING.snappy}
                    className="absolute inset-0 rounded-lg bg-accent"
                  />
                ) : null}
                <Icon
                  className={cn(
                    "relative size-4 shrink-0",
                    section.value === "danger" && !active && "text-destructive",
                  )}
                />
                <span className="relative">{section.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
