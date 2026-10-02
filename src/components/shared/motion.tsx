"use client";

import { Children, createContext, useContext, useMemo, type ReactNode } from "react";
import { motion, useReducedMotionConfig, type Variants } from "motion/react";

import { useHydrated } from "@/hooks/use-hydrated";
import { DURATION, EASE, STAGGER, staggerItem } from "@/lib/motion";

export interface FadeInProps {
  children: ReactNode;
  /** Seconds before the entrance starts. */
  delay?: number;
  /** Rise distance in pixels (default 8). Use 0 for a plain fade. */
  y?: number;
  className?: string;
}

/**
 * Fades its content in with a short rise, once, when it mounts. Content that
 * was part of the server HTML is not hidden while the page hydrates.
 */
export function FadeIn({ children, delay = 0, y = 8, className }: FadeInProps) {
  const hydrated = useHydrated();

  return (
    <motion.div
      initial={hydrated ? { opacity: 0, y } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE.out, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const STAGGER_TAGS = {
  div: motion.div,
  ul: motion.ul,
  ol: motion.ol,
  section: motion.section,
  tbody: motion.tbody,
} as const;

const STAGGER_ITEM_TAGS = {
  div: motion.div,
  li: motion.li,
  tr: motion.tr,
  article: motion.article,
} as const;

/** Entrance delay of the item rendered inside this provider, in seconds. */
const StaggerDelayContext = createContext(0);

export interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** Seconds between two items (default 0.04). */
  stagger?: number;
  /** Element to render (default "div"). */
  as?: keyof typeof STAGGER_TAGS;
}

/**
 * Plays the entrance of its `<StaggerItem>` children one after the other.
 *
 *   <Stagger className="grid gap-4 sm:grid-cols-2">
 *     {projects.map((project) => (
 *       <StaggerItem key={project.id}>…</StaggerItem>
 *     ))}
 *   </Stagger>
 *
 * Delays stop growing after 12 items, so a long list never waits on its tail,
 * and an item added later appears with the delay of its position at most.
 * For additions and removals, combine with `AnimatePresence` + `layout`.
 */
export function Stagger({ children, className, stagger = STAGGER.step, as = "div" }: StaggerProps) {
  const reducedMotion = useReducedMotionConfig();
  const hydrated = useHydrated();
  const step = reducedMotion ? 0 : stagger;
  const Component = STAGGER_TAGS[as];

  return (
    <Component initial={hydrated ? "hidden" : false} animate="visible" className={className}>
      {Children.map(children, (child, index) => (
        <StaggerDelayContext.Provider value={Math.min(index, STAGGER.maxItems) * step}>
          {child}
        </StaggerDelayContext.Provider>
      ))}
    </Component>
  );
}

export interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  /** Element to render (default "div"). */
  as?: keyof typeof STAGGER_ITEM_TAGS;
}

/** One animated entry of a `<Stagger>` (fade + 8 px rise). */
export function StaggerItem({ children, className, as = "div" }: StaggerItemProps) {
  const delay = useContext(StaggerDelayContext);
  const Component = STAGGER_ITEM_TAGS[as];

  const variants = useMemo<Variants>(
    () => ({
      hidden: staggerItem.hidden,
      visible: {
        opacity: 1,
        y: 0,
        transition: { duration: DURATION.base, ease: EASE.out, delay },
      },
    }),
    [delay],
  );

  return (
    <Component variants={variants} className={className}>
      {children}
    </Component>
  );
}
