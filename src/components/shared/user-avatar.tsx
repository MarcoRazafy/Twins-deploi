import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PROJECT_COLOR_CLASSES } from "@/lib/constants";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const TINTS = Object.values(PROJECT_COLOR_CLASSES);

const AVATAR_SIZES = {
  sm: { avatar: "sm", text: "text-[10px]" },
  md: { avatar: "default", text: "text-xs" },
  lg: { avatar: "lg", text: "text-sm" },
} as const;

/** Same name, same tint: people stay recognisable across screens. */
function tintFor(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return TINTS[hash % TINTS.length];
}

export interface UserAvatarProps {
  name: string;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}

/** Round avatar with the initials of a person, tinted from their name. */
export function UserAvatar({ name, size = "md", className }: UserAvatarProps) {
  const tint = tintFor(name);
  const { avatar, text } = AVATAR_SIZES[size];

  return (
    <Avatar size={avatar} title={name} className={className}>
      <AvatarFallback
        className={cn(
          "font-medium group-data-[size=sm]/avatar:text-[10px]",
          text,
          tint.bg,
          tint.text,
        )}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
