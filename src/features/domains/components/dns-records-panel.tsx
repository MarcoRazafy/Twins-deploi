"use client";

import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Info,
  LoaderCircle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { CopyButton } from "@/components/shared/copy-button";
import { ProgressBar } from "@/components/shared/progress-bar";
import { RelativeTime } from "@/components/shared/relative-time";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DURATION, EASE } from "@/lib/motion";
import { useSettings } from "@/lib/queries";
import type { DnsRecord, Domain, DomainStatus, PlatformSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useVerifyDomainAction } from "../hooks/use-domain-actions";
import { isVerificationRunning } from "../lib/domain-utils";

type RecordState = "verified" | "checking" | "failed" | "pending";

const RECORD_STATES: Record<RecordState, { label: string; icon: LucideIcon; className: string }> = {
  verified: { label: "Vérifié", icon: CircleCheck, className: "text-success" },
  checking: { label: "Vérification en cours", icon: LoaderCircle, className: "animate-spin text-info" },
  failed: { label: "Introuvable", icon: CircleAlert, className: "text-destructive" },
  pending: { label: "En attente", icon: CircleDashed, className: "text-warning" },
};

function recordState(record: DnsRecord, status: DomainStatus): RecordState {
  if (record.verified) return "verified";
  if (isVerificationRunning(status)) return "checking";
  return status === "error" ? "failed" : "pending";
}

function RecordStateIcon({ state }: { state: RecordState }) {
  const meta = RECORD_STATES[state];
  const Icon = meta.icon;

  return (
    <span title={meta.label} className="inline-flex">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: DURATION.base, ease: EASE.out } }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: DURATION.fast } }}
          className="inline-flex"
        >
          <Icon aria-hidden="true" className={cn("size-4", meta.className)} />
        </motion.span>
      </AnimatePresence>
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

/** Monospace value, truncated with its full text on hover, and a copy button. */
function RecordValue({
  value,
  copyLabel,
  className,
}: {
  value: string;
  copyLabel: string;
  className?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <span className={cn("truncate font-mono text-xs", className)} title={value}>
        {value}
      </span>
      <CopyButton value={value} size="icon-xs" tooltip={copyLabel} />
    </div>
  );
}

function TypeTag({ type }: { type: DnsRecord["type"] }) {
  return (
    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-medium">
      {type}
    </span>
  );
}

function providerHint(provider: PlatformSettings["dns"]["provider"] | undefined): string {
  if (provider === "cloudflare") {
    return "Zone gérée par Cloudflare : ajoutez ces enregistrements dans l’onglet DNS de la zone et laissez le proxy désactivé (nuage gris) le temps de l’émission du certificat.";
  }
  return "Ajoutez ces enregistrements dans la zone DNS de votre registrar ou de votre hébergeur DNS (OVH, Gandi, Namecheap, Cloudflare…). La propagation peut prendre quelques minutes.";
}

const HEAD_CLASS = "h-9 px-3 text-xs font-medium text-muted-foreground";
const CELL_CLASS = "px-3 py-2";

export interface DnsRecordsPanelProps {
  domain: Domain;
  className?: string;
}

/**
 * The DNS records to create for a custom domain, each value copyable, with the
 * check button. While a check runs the button is disabled and a progress bar
 * travels under it. Below `sm` the records stack as small cards: a table of
 * five columns does not fit a phone.
 */
export function DnsRecordsPanel({ domain, className }: DnsRecordsPanelProps) {
  const settings = useSettings();
  const { verify, isPending } = useVerifyDomainAction();
  const running = isVerificationRunning(domain.status);
  const busy = running || isPending;
  const hasApexRecord = domain.dnsRecords.some((record) => record.name === "@");

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-start gap-2.5 rounded-lg bg-secondary px-3 py-2.5 text-sm text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1.5">
          {settings.isPending ? (
            <Skeleton className="h-4 w-64 max-w-full" />
          ) : (
            <p>{providerHint(settings.data?.dns.provider)}</p>
          )}
          {hasApexRecord && settings.data ? (
            <p>
              Si votre registrar refuse un CNAME à la racine, utilisez un enregistrement A (ou
              ALIAS) vers <span className="font-mono text-foreground">{settings.data.dns.serverIp}</span>.
            </p>
          ) : null}
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-lg border sm:block">
        <Table>
          <TableHeader className="bg-secondary/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD_CLASS}>Type</TableHead>
              <TableHead className={HEAD_CLASS}>Nom</TableHead>
              <TableHead className={HEAD_CLASS}>Valeur</TableHead>
              <TableHead className={HEAD_CLASS}>TTL</TableHead>
              <TableHead className={cn(HEAD_CLASS, "w-10")}>
                <span className="sr-only">État</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domain.dnsRecords.map((record) => (
              <TableRow key={`${record.type}:${record.name}`}>
                <TableCell className={CELL_CLASS}>
                  <TypeTag type={record.type} />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <RecordValue value={record.name} copyLabel="Copier le nom" className="max-w-[10rem]" />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <RecordValue
                    value={record.value}
                    copyLabel="Copier la valeur"
                    className="max-w-[13rem]"
                  />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <span className="tabular font-mono text-xs text-muted-foreground">
                    {record.ttl}
                  </span>
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <RecordStateIcon state={recordState(record, domain.status)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul aria-label="Enregistrements DNS" className="divide-y rounded-lg border sm:hidden">
        {domain.dnsRecords.map((record) => (
          <li key={`${record.type}:${record.name}`} className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TypeTag type={record.type} />
                <span className="tabular text-xs text-muted-foreground">TTL {record.ttl}</span>
              </div>
              <RecordStateIcon state={recordState(record, domain.status)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Nom</p>
              <RecordValue value={record.name} copyLabel="Copier le nom" className="max-w-[14rem]" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Valeur</p>
              <RecordValue
                value={record.value}
                copyLabel="Copier la valeur"
                className="max-w-[14rem]"
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            type="button"
            variant={domain.status === "active" ? "outline" : "default"}
            disabled={busy}
            onClick={() => verify(domain)}
          >
            {busy ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            Vérifier la configuration
          </Button>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {running ? (
              "Vérification en cours…"
            ) : domain.lastCheckedAt ? (
              <RelativeTime prefix="Dernière vérification" date={domain.lastCheckedAt} />
            ) : (
              "Pas encore vérifié"
            )}
          </p>
        </div>
        {running ? (
          <ProgressBar indeterminate tone="info" size="sm" label="Vérification du domaine en cours" />
        ) : null}
      </div>
    </div>
  );
}
