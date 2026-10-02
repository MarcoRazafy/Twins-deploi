"use client";

import Link from "next/link";
import { GitBranch, Lock, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { shortSha } from "@/lib/format";
import type { GithubBranch } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface BranchSelectProps {
  branches: readonly GithubBranch[];
  value: string;
  onChange: (branch: string) => void;
  /** Two-line options: last commit message and short sha under the name. */
  detailed?: boolean;
  size?: "sm" | "default";
  id?: string;
  "aria-label"?: string;
  title?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

/** Select of the branches of a repository, with the default branch flagged. */
export function BranchSelect({
  branches,
  value,
  onChange,
  detailed = false,
  size = "default",
  id,
  "aria-label": ariaLabel,
  title,
  disabled,
  invalid,
  className,
}: BranchSelectProps) {
  // A branch deleted on GitHub, or not loaded yet, must still read as the
  // current value.
  const known = branches.some((branch) => branch.name === value);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={title}
        size={size}
        className={cn("w-full", className)}
      >
        <SelectValue>
          <GitBranch className="text-muted-foreground" />
          <span className="truncate">{value}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        className="max-w-[min(28rem,calc(100vw-2rem))]"
      >
        {known ? null : (
          <SelectItem value={value}>
            <GitBranch className="text-muted-foreground" />
            <span className="truncate">{value}</span>
          </SelectItem>
        )}
        {branches.map((branch) => (
          <SelectItem key={branch.name} value={branch.name}>
            <GitBranch className="text-muted-foreground" />
            {detailed ? (
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="flex max-w-full items-center gap-1.5">
                  <span className="truncate font-medium">{branch.name}</span>
                  {branch.isDefault ? (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      Par défaut
                    </Badge>
                  ) : null}
                  {branch.protected ? (
                    <Lock aria-label="Branche protégée" className="size-3 text-muted-foreground" />
                  ) : null}
                </span>
                <span className="max-w-full truncate text-xs text-muted-foreground">
                  <span className="font-mono">{shortSha(branch.lastCommit.sha)}</span>
                  {branch.lastCommit.message ? ` · ${branch.lastCommit.message}` : null}
                </span>
              </span>
            ) : (
              <>
                <span className="truncate">{branch.name}</span>
                {branch.isDefault ? (
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                    Par défaut
                  </Badge>
                ) : null}
              </>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface BranchesErrorRowProps {
  onRetry: () => void;
  /** When set, adds a link to the GitHub page (connect or manage the account). */
  githubHref?: string;
  /** Whether GitHub is connected: only changes the wording of the link. */
  connected?: boolean;
}

/** "Impossible de charger les branches. Réessayer", shown in place of the select. */
export function BranchesErrorRow({ onRetry, githubHref, connected = true }: BranchesErrorRowProps) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
    >
      <span className="flex items-center gap-2 text-destructive">
        <TriangleAlert className="size-4 shrink-0" />
        Impossible de charger les branches.
      </span>
      <span className="flex items-center gap-3">
        <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={onRetry}>
          Réessayer
        </Button>
        {githubHref ? (
          <Link
            href={githubHref}
            className="text-xs text-brand-400 underline-offset-4 hover:underline"
          >
            {connected ? "Gérer GitHub" : "Connecter GitHub"}
          </Link>
        ) : null}
      </span>
    </div>
  );
}
