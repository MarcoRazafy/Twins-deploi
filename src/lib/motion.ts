/**
 * Motion tokens and shared variants (DESIGN.md §7).
 *
 * Components never invent a duration or a curve: they take them from here.
 * Variants use three states: `hidden` → `visible`, and `exit` (shorter than
 * the entrance) for elements removed through `<AnimatePresence>`.
 *
 *   <motion.div variants={fadeUp} initial="hidden" animate="visible" exit="exit" />
 */

import type { Transition, Variants } from "motion/react";

type CubicBezier = [number, number, number, number];

/** Seconds. */
export const DURATION = {
  /** Hover, press, exits. */
  fast: 0.15,
  /** Element entrances, state changes. */
  base: 0.22,
  /** Panels, page transitions. */
  slow: 0.35,
} as const;

export const EASE: { out: CubicBezier; inOut: CubicBezier } = {
  /** Every entrance. */
  out: [0.16, 1, 0.3, 1],
  /** Moves between two positions. */
  inOut: [0.65, 0, 0.35, 1],
};

export const SPRING = {
  /** Shared indicators (`layoutId`), drag and drop. */
  snappy: { type: "spring", stiffness: 520, damping: 40, mass: 0.9 },
  /** Panels, cards, canvas zoom. */
  smooth: { type: "spring", stiffness: 260, damping: 30, mass: 1 },
} as const satisfies Record<string, Transition>;

/** List/grid entrance: 40 ms between items, delays capped after 12 items. */
export const STAGGER = {
  step: 0.04,
  maxItems: 12,
} as const;

const enter: Transition = { duration: DURATION.base, ease: EASE.out };
const leave: Transition = { duration: DURATION.fast, ease: EASE.out };

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: enter },
  exit: { opacity: 0, transition: leave },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: enter },
  exit: { opacity: 0, y: 4, transition: leave },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: enter },
  exit: { opacity: 0, scale: 0.98, transition: leave },
};

/** Page entrance used by `<PageContainer>`. */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.slow, ease: EASE.out },
  },
};

/** Parent of `staggerItem` children: plays them one after the other. */
export function staggerContainer(stagger: number = STAGGER.step): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: stagger } },
    exit: {},
  };
}

export const staggerItem: Variants = fadeUp;

/** Side panels: slide in from the right, leave faster than they came. */
export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: SPRING.smooth },
  exit: {
    opacity: 0,
    x: 24,
    transition: { duration: DURATION.base, ease: EASE.inOut },
  },
};

/** Spread on a clickable `motion` card: `<motion.div {...hoverLift} />`. */
export const hoverLift = {
  whileHover: { y: -2 },
  whileTap: { scale: 0.985 },
  transition: { duration: DURATION.fast, ease: EASE.out },
} as const;

/** Spread on a small pressable `motion` element. */
export const tapScale = {
  whileTap: { scale: 0.97 },
  transition: { duration: DURATION.fast, ease: EASE.out },
} as const;
