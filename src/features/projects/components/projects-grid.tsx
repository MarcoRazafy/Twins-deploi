"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";

import { DURATION, EASE, SPRING, STAGGER, staggerItem } from "@/lib/motion";
import type { ProjectSummary } from "@/lib/types";

import { ProjectCard } from "./project-card";

// `custom` is the position of the card: delays stop growing after 12 cards, so
// a long list never waits on its tail, and a card that appears later (search
// cleared, project created) enters almost at once.
const itemVariants: Variants = {
  hidden: staggerItem.hidden,
  visible: (position: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATION.base,
      ease: EASE.out,
      delay: Math.min(position, STAGGER.maxItems) * STAGGER.step,
    },
  }),
  exit: staggerItem.exit,
};

/**
 * Responsive grid of project cards. Cards enter in sequence, slide to their
 * new place when the list is filtered or sorted, and fade out when removed.
 */
export function ProjectsGrid({ projects }: { projects: readonly ProjectSummary[] }) {
  return (
    // `relative`: removed cards are taken out of the flow while they fade out.
    <motion.div
      initial="hidden"
      animate="visible"
      className="relative grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3"
    >
      <AnimatePresence mode="popLayout">
        {projects.map((project, position) => (
          <motion.div
            key={project.id}
            layout
            custom={position}
            variants={itemVariants}
            exit="exit"
            transition={{ layout: SPRING.smooth }}
          >
            <ProjectCard project={project} />
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
