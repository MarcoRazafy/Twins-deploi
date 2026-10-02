"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { CopyButton } from "@/components/shared/copy-button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Fixed length: the mask must not reveal how long the secret is.
const MASK = "•".repeat(16);

export interface CopyFieldProps {
  label?: string;
  value: string;
  /** Monospace: URLs, identifiers, tokens, connection strings. */
  mono?: boolean;
  /** Masks the value until the user reveals it. Copy always uses the real value. */
  secret?: boolean;
  className?: string;
}

/** Read-only field with a copy button, and a reveal toggle for secrets. */
export function CopyField({ label, value, mono = false, secret = false, className }: CopyFieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const masked = secret && !revealed;

  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-2", className)}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <InputGroup>
        <InputGroupInput
          id={id}
          readOnly
          value={masked ? MASK : value}
          aria-label={label ? undefined : "Valeur"}
          spellCheck={false}
          onFocus={(event) => {
            if (!masked) event.currentTarget.select();
          }}
          className={cn(
            "truncate",
            mono && "font-mono text-[13px] md:text-[13px]",
            masked && "tracking-wider text-muted-foreground",
          )}
        />
        <InputGroupAddon align="inline-end" className="gap-0.5">
          {secret ? (
            <InputGroupButton
              size="icon-xs"
              aria-label={revealed ? "Masquer la valeur" : "Afficher la valeur"}
              aria-pressed={revealed}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </InputGroupButton>
          ) : null}
          <CopyButton value={value} size="icon-xs" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
