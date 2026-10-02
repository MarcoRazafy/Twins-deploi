"use client";

import { ExternalLink, Globe, Lock, LockOpen, Sparkles, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { CopyButton } from "@/components/shared/copy-button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate, formatShortDate } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import type { Domain, DomainKind, DomainStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  DOMAIN_KIND_LABELS,
  formatSslCountdown,
  isSslExpiringSoon,
  sslMsLeft,
} from "../lib/domain-utils";

/** Open-in-a-new-tab link and copy button that follow a hostname everywhere. */
export function DomainQuickActions({
  hostname,
  className,
}: {
  hostname: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
          >
            <a
              href={`https://${hostname}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Ouvrir ${hostname} dans un nouvel onglet`}
              // The link often sits in a clickable table row.
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ouvrir dans un nouvel onglet</TooltipContent>
      </Tooltip>
      <CopyButton value={hostname} size="icon-xs" tooltip="Copier le domaine" />
    </span>
  );
}

/** The status badge, cross-fading in place when the status changes. */
export function DomainStatusBadge({
  status,
  size,
}: {
  status: DomainStatus;
  size?: "sm" | "md";
}) {
  return (
    <span aria-live="polite" className="inline-flex">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: DURATION.base, ease: EASE.out } }}
          exit={{ opacity: 0, scale: 0.92, transition: { duration: DURATION.fast } }}
          className="inline-flex"
        >
          <StatusBadge kind="domain" status={status} size={size} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function DomainKindBadge({ kind, className }: { kind: DomainKind; className?: string }) {
  return (
    <Badge variant={kind === "generated" ? "outline" : "secondary"} className={className}>
      {kind === "generated" ? <Sparkles aria-hidden="true" /> : <Globe aria-hidden="true" />}
      {DOMAIN_KIND_LABELS[kind]}
    </Badge>
  );
}

function sslSummary(domain: Domain): string {
  const { status, expiresAt } = domain.ssl;
  if (status === "issued") {
    return `Certificat SSL valide${expiresAt ? ` jusqu’au ${formatDate(expiresAt)}` : ""}`;
  }
  if (status === "pending") return "Certificat SSL en cours d’émission";
  if (status === "error") return "Erreur de certificat SSL";
  return "Pas de certificat SSL";
}

/** Padlock that tells at a glance whether the domain is served over HTTPS. */
export function DomainSslLock({ domain }: { domain: Domain }) {
  const { status } = domain.ssl;
  const label = sslSummary(domain);
  const Icon = status === "issued" ? Lock : LockOpen;
  const tone =
    status === "issued"
      ? "text-success"
      : status === "error"
        ? "text-destructive"
        : status === "pending"
          ? "text-warning"
          : "text-muted-foreground";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          tabIndex={0}
          className={cn(
            "inline-flex rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            tone,
          )}
        >
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Certificate status plus its expiry as a short date, in the warning tone under 30 days. */
export function DomainSslCell({ domain, now }: { domain: Domain; now: number }) {
  const { ssl } = domain;
  const msLeft = sslMsLeft(domain, now);
  const soon = isSslExpiringSoon(domain, now);

  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge kind="ssl" status={ssl.status} size="sm" showIcon />
      {ssl.expiresAt && now > 0 ? (
        <span
          title={msLeft !== null ? formatSslCountdown(msLeft) : formatDate(ssl.expiresAt)}
          className={cn(
            "tabular inline-flex items-center gap-1 text-xs",
            soon ? "text-warning" : "text-muted-foreground",
          )}
        >
          {soon ? <TriangleAlert aria-hidden="true" className="size-3" /> : null}
          {msLeft !== null && msLeft <= 0
            ? "Expiré"
            : `Expire le ${formatShortDate(ssl.expiresAt, now)}`}
        </span>
      ) : null}
    </div>
  );
}
