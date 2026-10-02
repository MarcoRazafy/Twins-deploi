import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface KitSectionProps {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}

/** One chapter of the style guide. */
export function KitSection({ id, title, description, children }: KitSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-16 space-y-4">
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="max-w-3xl text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-4">{children}</div>
    </section>
  );
}

interface KitExampleProps {
  title: string;
  /** Component or recipe being shown, in code style. */
  code?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** Framed example with the name of what it demonstrates. */
export function KitExample({ title, code, children, className, bodyClassName }: KitExampleProps) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b px-4 py-2.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {code ? (
          <code className="truncate font-mono text-xs text-muted-foreground">{code}</code>
        ) : null}
      </div>
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </div>
  );
}

/** Small caption above a group of variants inside an example. */
export function KitLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
}
