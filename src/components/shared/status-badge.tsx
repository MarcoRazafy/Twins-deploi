import type { ReactNode } from "react";

import {
  getContainerStateMeta,
  getStatusMeta,
  TONE_CLASSES,
  type StatusOf,
  type StatusTone,
} from "@/lib/status";
import { cn } from "@/lib/utils";

export interface StatusDotProps {
  tone: StatusTone;
  /** Adds the expanding halo of in-progress statuses. */
  pulse?: boolean;
  className?: string;
  /**
   * Accessible name. Leave it out when a visible label sits next to the dot
   * (the dot is then decorative); set it when the dot stands alone.
   */
  label?: string;
}

export function StatusDot({ tone, pulse = false, className, label }: StatusDotProps) {
  const color = TONE_CLASSES[tone].dot;

  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={cn("relative inline-flex size-2 shrink-0", className)}
    >
      {pulse ? (
        <span className={cn("absolute inset-0 animate-pulse-ring rounded-full", color)} />
      ) : null}
      <span className={cn("relative size-full rounded-full", color)} />
    </span>
  );
}

export type StatusBadgeProps = StatusOf & {
  size?: "sm" | "md";
  /** Shows the status icon instead of the dot. */
  showIcon?: boolean;
  /** Replaces the default label of the status. */
  label?: ReactNode;
  /**
   * Containers only: a non-zero exit code turns `exited` into a failure
   * (danger tone, code in the label).
   */
  exitCode?: number | null;
  className?: string;
};

/**
 * The one way to display a status. `kind` selects the status family and
 * `status` is typed accordingly:
 *
 *   <StatusBadge kind="deployment" status={deployment.status} />
 *   <StatusBadge kind="container" status={container.state} exitCode={container.exitCode} />
 */
export function StatusBadge(props: StatusBadgeProps) {
  const { size = "md", showIcon = false, label, exitCode, className } = props;
  const meta =
    props.kind === "container"
      ? getContainerStateMeta(props.status, exitCode)
      : getStatusMeta(props);
  const tone = TONE_CLASSES[meta.tone];
  const Icon = meta.icon;
  const small = size === "sm";

  return (
    <span
      data-slot="status-badge"
      data-tone={meta.tone}
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full border font-medium whitespace-nowrap",
        small ? "h-5 gap-1 pr-2 pl-1.5 text-[11px]" : "h-6 gap-1.5 pr-2.5 pl-2 text-xs",
        tone.bg,
        tone.text,
        tone.border,
        className,
      )}
    >
      {showIcon ? (
        <Icon
          aria-hidden="true"
          className={cn(
            "shrink-0",
            small ? "size-3" : "size-3.5",
            meta.pulse && "animate-pulse",
          )}
        />
      ) : (
        <StatusDot
          tone={meta.tone}
          pulse={meta.pulse}
          className={small ? "size-1.5" : undefined}
        />
      )}
      {label ?? meta.label}
    </span>
  );
}
