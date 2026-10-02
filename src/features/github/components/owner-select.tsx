"use client";

import { Building2, User, Users } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GithubAccount, GithubConnection } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Radix Select forbids an empty item value, so "everyone" travels under a sentinel. */
const ALL = "__all__";

export interface OwnerSelectProps {
  connection: GithubConnection;
  /** Login of the selected account or organisation, `null` for all of them. */
  value: string | null;
  onChange: (owner: string | null) => void;
  /** Sets the width (default: full width, `w-52` from `sm`). */
  className?: string;
}

/** Filter of the repositories by owner: the account and its organisations. */
export function OwnerSelect({ connection, value, onChange, className }: OwnerSelectProps) {
  const accounts: GithubAccount[] = connection.account
    ? [connection.account, ...connection.organizations]
    : connection.organizations;

  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
      <SelectTrigger aria-label="Filtrer par propriétaire" className={cn("w-full sm:w-52", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>
          <Users className="text-muted-foreground" />
          Tous les propriétaires
        </SelectItem>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.login}>
            {account.type === "organization" ? (
              <Building2 className="text-muted-foreground" />
            ) : (
              <User className="text-muted-foreground" />
            )}
            <span className="truncate">{account.login}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
