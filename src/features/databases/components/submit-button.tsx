import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, "type" | "asChild"> & {
  pending: boolean;
};

/** Submit button whose spinner replaces the label in place: the width never changes. */
export function SubmitButton({
  pending,
  disabled,
  className,
  children,
  ...props
}: SubmitButtonProps) {
  return (
    <Button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn("relative max-sm:h-10", className)}
      {...props}
    >
      <span className={cn("inline-flex items-center gap-1.5", pending && "invisible")}>
        {children}
      </span>
      {pending ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner aria-label="Opération en cours" />
        </span>
      ) : null}
    </Button>
  );
}
