import {
  DockerIcon,
  GithubIcon,
  PostgresIcon,
  type BrandIconProps,
} from "@/components/icons/brand-icons";
import type { ServiceType } from "@/lib/types";
import { cn } from "@/lib/utils";

const SERVICE_ICONS: Record<
  ServiceType,
  { Icon: (props: BrandIconProps) => React.ReactNode; color: string }
> = {
  github: { Icon: GithubIcon, color: "text-foreground" },
  docker: { Icon: DockerIcon, color: "text-info" },
  postgres: { Icon: PostgresIcon, color: "text-info" },
};

const TILE_SIZES = {
  sm: { tile: "size-7 rounded-md", icon: "size-3.5" },
  md: { tile: "size-9 rounded-lg", icon: "size-[18px]" },
  lg: { tile: "size-11 rounded-xl", icon: "size-[22px]" },
} as const;

export interface ServiceIconProps {
  type: ServiceType;
  /**
   * Places the mark in a rounded tile (`true` is "md"). Without it the bare
   * icon is rendered at `size-4`.
   */
  tile?: boolean | keyof typeof TILE_SIZES;
  /** Classes of the outer element: the tile when there is one, else the icon. */
  className?: string;
  /** Classes of the icon inside a tile. */
  iconClassName?: string;
  /**
   * Accessible name. The mark is decorative by default because the service
   * name or type is normally written next to it.
   */
  title?: string;
}

/** Brand mark of a service type: GitHub, Docker or PostgreSQL. */
export function ServiceIcon({ type, tile = false, className, iconClassName, title }: ServiceIconProps) {
  const { Icon, color } = SERVICE_ICONS[type];

  if (!tile) {
    return <Icon title={title} className={cn("size-4 shrink-0", color, className)} />;
  }

  const size = TILE_SIZES[tile === true ? "md" : tile];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-secondary",
        size.tile,
        className,
      )}
    >
      <Icon title={title} className={cn(size.icon, color, iconClassName)} />
    </span>
  );
}
