import { isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";

/** A Lucide icon or a brand icon: any component that accepts `className`. */
export type IconComponent = ComponentType<{ className?: string }>;

/**
 * Icon prop accepted across the kit: either an icon component (`icon={Rocket}`),
 * which the kit sizes and tints itself, or an element rendered as is
 * (`icon={<ProjectAvatar … />}`).
 */
export type IconProp = IconComponent | ReactElement;

export function renderIcon(icon: IconProp | null | undefined, className?: string): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  const Icon = icon;
  return <Icon className={className} />;
}
