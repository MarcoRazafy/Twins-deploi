import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface TableShellProps {
  /** Row above the table: `SearchInput` first, then filters, then the CTA. */
  toolbar?: ReactNode;
  /** Row under the table: result count, pagination. */
  footer?: ReactNode;
  /** A shadcn `<Table>`. */
  children: ReactNode;
  className?: string;
}

/**
 * The card around a table. It also applies the table recipe of the design
 * system to the shadcn table parts inside it (muted header on a raised
 * strip, comfortable cell padding, accent row hover), so feature tables only
 * describe their columns.
 *
 * The recipe targets the parts through descendant selectors, which outrank a
 * utility set on the part itself: a cell that needs different padding uses
 * the important modifier (`px-0!`).
 */
export function TableShell({ toolbar, footer, children, className }: TableShellProps) {
  return (
    <div
      data-slot="table-shell"
      className={cn("overflow-hidden rounded-xl border bg-card", className)}
    >
      {toolbar ? (
        <div className="flex flex-wrap items-center gap-2 border-b p-3">{toolbar}</div>
      ) : null}

      <div
        className={cn(
          "overflow-x-auto",
          "[&_[data-slot=table-header]]:bg-secondary/40",
          "[&_[data-slot=table-header]_[data-slot=table-row]]:hover:bg-transparent",
          "[&_[data-slot=table-head]]:h-9 [&_[data-slot=table-head]]:px-4 [&_[data-slot=table-head]]:text-xs [&_[data-slot=table-head]]:font-medium [&_[data-slot=table-head]]:text-muted-foreground",
          "[&_[data-slot=table-cell]]:px-4 [&_[data-slot=table-cell]]:py-3",
          "[&_[data-slot=table-body]_[data-slot=table-row]]:hover:bg-accent/40",
        )}
      >
        {children}
      </div>

      {footer ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
