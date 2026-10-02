"use client";

import { useId, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DashboardSectionProps {
  title: ReactNode;
  /** Right of the heading: a link or a short figure, on one line. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Titled block of the dashboard. The heading sits above its content, like the
 * grid of project cards (which are surfaces of their own), so every block of
 * the two-column area lines up the same way. The heading row has a fixed
 * height: a block with a button and a block without one stay aligned.
 */
export function DashboardSection({ title, actions, children, className }: DashboardSectionProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 id={headingId} className="min-w-0 truncate text-base font-medium">
          {title}
        </h2>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export interface DashboardCardProps {
  children: ReactNode;
  className?: string;
}

export function DashboardCard({ children, className }: DashboardCardProps) {
  return <div className={cn("rounded-xl border bg-card", className)}>{children}</div>;
}

export interface SectionLinkProps {
  href: string;
  children: ReactNode;
}

/** Quiet link at the right of a heading ("Voir tout"). */
export function SectionLink({ href, children }: SectionLinkProps) {
  return (
    // The negative margin lines the label up with the right edge of the content.
    <Button asChild variant="ghost" className="-mr-2.5 text-muted-foreground hover:text-foreground">
      <Link href={href}>
        {children}
        <ArrowRight data-icon="inline-end" />
      </Link>
    </Button>
  );
}
