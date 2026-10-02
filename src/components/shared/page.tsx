"use client";

import { isValidElement, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";

import { renderIcon, type IconProp } from "@/components/shared/render-icon";
import { useHydrated } from "@/hooks/use-hydrated";
import { pageEnter } from "@/lib/motion";
import { cn } from "@/lib/utils";

const CONTAINER_SIZES = {
  default: "max-w-[1400px]",
  /** Forms and settings: a comfortable reading width. */
  narrow: "max-w-4xl",
  /** Dense tables that benefit from every pixel. */
  wide: "max-w-[1800px]",
} as const;

export interface PageContainerProps {
  children: ReactNode;
  size?: keyof typeof CONTAINER_SIZES;
  className?: string;
}

/**
 * Standard page frame: max width, responsive gutters, 24 px between sections
 * and the page-enter animation. Every page except the workspace uses it.
 */
export function PageContainer({ children, size = "default", className }: PageContainerProps) {
  // A page that arrives as server HTML is shown as is; only pages reached by
  // client-side navigation play the entrance.
  const hydrated = useHydrated();

  return (
    <motion.div
      variants={pageEnter}
      initial={hydrated ? "hidden" : false}
      animate="visible"
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8",
        CONTAINER_SIZES[size],
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /**
   * An icon component is shown in a tile; an element (avatar, service icon…)
   * is rendered as is.
   */
  icon?: IconProp;
  /** Buttons on the right. They move under the title on small screens. */
  actions?: ReactNode;
  /** Adds a back link above the title. */
  backHref?: string;
  /** Defaults to "Retour". */
  backLabel?: string;
  /** Shown next to the title, typically a `<StatusBadge>`. */
  badge?: ReactNode;
  /** Extra row under the header: metadata, tabs… */
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  backHref,
  backLabel = "Retour",
  badge,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="group -ml-1 inline-flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
          {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            isValidElement(icon) ? (
              <div className="flex shrink-0 items-center">{icon}</div>
            ) : (
              <div className="surface-highlight flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-muted-foreground">
                {renderIcon(icon, "size-5")}
              </div>
            )
          ) : null}
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words sm:text-2xl">
                {title}
              </h1>
              {badge}
            </div>
            {description ? (
              <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {children}
    </header>
  );
}
