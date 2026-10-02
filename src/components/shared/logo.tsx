import Image from "next/image";

import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import logoMark from "@/assets/logo-mark.png";

/** Mini Railway mark (the artwork provided by the owner, on a transparent background). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src={logoMark}
      alt=""
      aria-hidden="true"
      priority
      className={cn("size-7 shrink-0 object-contain", className)}
    />
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        {APP_NAME}
      </span>
    </span>
  );
}
