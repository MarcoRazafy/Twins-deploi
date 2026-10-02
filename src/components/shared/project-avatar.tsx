import { PROJECT_COLOR_CLASSES } from "@/lib/constants";
import { initials } from "@/lib/format";
import type { ProjectColor } from "@/lib/types";
import { cn } from "@/lib/utils";

const AVATAR_SIZES = {
  xs: "size-5 rounded-[5px] text-[9px]",
  sm: "size-6 rounded-md text-[10px]",
  md: "size-8 rounded-lg text-xs",
  lg: "size-10 rounded-xl text-sm",
} as const;

export interface ProjectAvatarProps {
  name: string;
  color: ProjectColor;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}

/**
 * Initials of a project on its accent colour. Decorative: the project name is
 * expected next to it.
 */
export function ProjectAvatar({ name, color, size = "md", className }: ProjectAvatarProps) {
  // Stored data may carry a colour that no longer exists.
  const palette = PROJECT_COLOR_CLASSES[color] ?? PROJECT_COLOR_CLASSES.purple;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold tracking-tight ring-1 ring-current/15 select-none ring-inset",
        AVATAR_SIZES[size],
        palette.bg,
        palette.text,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
