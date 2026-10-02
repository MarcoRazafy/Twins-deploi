"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { motion } from "motion/react";

import type { IconComponent } from "@/components/shared/render-icon";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface UnderlineTab<Value extends string = string> {
  value: Value;
  label: string;
  icon?: IconComponent;
  /** Small counter after the label (number of deployments, variables…). */
  count?: number;
  disabled?: boolean;
}

export interface UnderlineTabsProps<Value extends string = string> {
  tabs: ReadonlyArray<UnderlineTab<Value>>;
  value: Value;
  onValueChange: (value: Value) => void;
  className?: string;
  /**
   * Shared-layout id of the sliding underline. Unique per instance by
   * default; only set it to make two tab bars share one indicator.
   */
  layoutId?: string;
  /** Accessible name of the tab list. */
  label?: string;
  /**
   * When set, tabs get `id="{idBase}-tab-{value}"` and
   * `aria-controls="{idBase}-panel-{value}"` so panels can point back with
   * `aria-labelledby`.
   */
  idBase?: string;
}

/**
 * Tab bar of the reference UI: muted labels, the active one in white with an
 * underline that slides between tabs. Scrolls horizontally when it does not
 * fit. Arrow keys, Home and End move between tabs (roving tabindex).
 */
export function UnderlineTabs<Value extends string = string>({
  tabs,
  value,
  onValueChange,
  className,
  layoutId,
  label,
  idBase,
}: UnderlineTabsProps<Value>) {
  const generatedId = useId();
  const indicatorId = layoutId ?? `underline-tabs-${generatedId}`;
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the active tab visible when the bar scrolls (mobile, many tabs).
  // Only the bar scrolls: `scrollIntoView` could also move the page.
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !active) return;

    const start = active.offsetLeft;
    const end = start + active.offsetWidth;
    if (start < list.scrollLeft) {
      list.scrollTo({ left: Math.max(0, start - 16), behavior: "smooth" });
    } else if (end > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: end - list.clientWidth + 16, behavior: "smooth" });
    }
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = tabs.filter((tab) => !tab.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex((tab) => tab.value === value);

    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (current + 1) % enabled.length;
        break;
      case "ArrowLeft":
        next = (current - 1 + enabled.length) % enabled.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = enabled.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const target = enabled[next];
    if (target.value !== value) onValueChange(target.value);
    const index = tabs.indexOf(target);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
  }

  // When the value matches no tab, the first enabled one stays reachable.
  const hasActive = tabs.some((tab) => tab.value === value && !tab.disabled);
  const fallbackFocus = tabs.find((tab) => !tab.disabled)?.value;

  return (
    <div className={cn("border-b", className)}>
      <motion.div
        ref={listRef}
        layoutScroll
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className="relative -mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const active = tab.value === value;
          const Icon = tab.icon;
          const focusable = hasActive ? active : tab.value === fallbackFocus;

          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={idBase ? `${idBase}-tab-${tab.value}` : undefined}
              aria-controls={idBase ? `${idBase}-panel-${tab.value}` : undefined}
              aria-selected={active}
              disabled={tab.disabled}
              tabIndex={focusable ? 0 : -1}
              onClick={() => {
                if (!active) onValueChange(tab.value);
              }}
              className={cn(
                "group relative inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
                "disabled:pointer-events-none disabled:opacity-50",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {Icon ? <Icon className="size-4 shrink-0" /> : null}
              {tab.label}
              {tab.count !== undefined ? (
                <span
                  className={cn(
                    "tabular rounded-full px-1.5 text-[11px] leading-[18px] transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
              {active ? (
                <motion.span
                  layoutId={indicatorId}
                  transition={SPRING.snappy}
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-400"
                />
              ) : null}
            </button>
          );
        })}
      </motion.div>
    </div>
  );
}
