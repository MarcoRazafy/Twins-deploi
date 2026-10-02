"use client";

import { useId, useState } from "react";
import { ChevronDown, Ellipsis, Globe, Info, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { CopyField } from "@/components/shared/copy-field";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { FadeIn } from "@/components/shared/motion";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getErrorMessage } from "@/lib/api/contract";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { useDomains, useGenerateDomain, useService } from "@/lib/queries";
import type { Domain, Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useDomainActions, type DomainActions } from "../hooks/use-domain-actions";
import { internalAddress, isVerificationRunning } from "../lib/domain-utils";
import { DomainDialog } from "./add-domain-dialog";
import { DnsRecordsPanel } from "./dns-records-panel";
import {
  DomainKindBadge,
  DomainQuickActions,
  DomainSslLock,
  DomainStatusBadge,
} from "./domain-parts";
import { EditPortDialog } from "./edit-port-dialog";

function ItemMenu({
  domain,
  actions,
  onEditPort,
}: {
  domain: Domain;
  actions: DomainActions;
  onEditPort: (domain: Domain) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions pour ${domain.hostname}`}
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        {domain.kind === "custom" ? (
          <DropdownMenuItem
            disabled={isVerificationRunning(domain.status)}
            onSelect={() => actions.verify(domain)}
          >
            <RefreshCw />
            Vérifier le DNS
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => onEditPort(domain)}>
          <Pencil />
          Modifier le port
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => actions.requestDelete(domain)}>
          <Trash2 />
          Supprimer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DomainItemProps {
  domain: Domain;
  actions: DomainActions;
  onEditPort: (domain: Domain) => void;
}

function DomainItem({ domain, actions, onEditPort }: DomainItemProps) {
  // A domain waiting for its DNS shows the records straight away; the user can fold them.
  const [dnsOpen, setDnsOpen] = useState(
    domain.status === "pending_dns" || domain.status === "error",
  );
  const showDns = domain.kind === "custom" && domain.status !== "active";

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
      transition={{ layout: SPRING.smooth }}
      className="rounded-xl border bg-card"
    >
      <div className="flex items-start gap-2 p-3 sm:px-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 items-center gap-0.5">
            <span className="min-w-0 truncate font-mono text-[13px]" title={domain.hostname}>
              {domain.hostname}
            </span>
            <DomainQuickActions hostname={domain.hostname} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted-foreground">
            <DomainStatusBadge status={domain.status} size="sm" />
            <DomainSslLock domain={domain} />
            <DomainKindBadge kind={domain.kind} />
            <span className="tabular">Port {domain.targetPort}</span>
          </div>
        </div>
        <ItemMenu domain={domain} actions={actions} onEditPort={onEditPort} />
      </div>

      {showDns ? (
        <Collapsible open={dnsOpen} onOpenChange={setDnsOpen} className="border-t">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-b-xl px-3 py-2.5 text-left text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-4"
            >
              Enregistrements DNS à créer
              <ChevronDown
                aria-hidden="true"
                className={cn("size-4 transition-transform", dnsOpen && "rotate-180")}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <FadeIn y={4}>
              <div className="px-3 pb-3 sm:px-4 sm:pb-4">
                <DnsRecordsPanel domain={domain} />
              </div>
            </FadeIn>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </motion.li>
  );
}

function PrivateNetwork({ service, showDatabaseNote }: { service: Service; showDatabaseNote: boolean }) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h3 id={headingId} className="text-base font-medium">
          Réseau privé
        </h3>
        <p className="text-sm text-muted-foreground">
          Les autres services du projet joignent celui-ci par ce nom interne, sans passer par
          Internet.
        </p>
      </div>
      <CopyField
        label="Adresse interne"
        value={internalAddress(service.name, service.config.port)}
        mono
      />
      <p className="text-xs text-muted-foreground">
        Utilisez-la dans les variables d’environnement des services qui en ont besoin. Elle n’est
        pas accessible depuis l’extérieur.
      </p>
      {showDatabaseNote ? (
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Pas d’exposition HTTP</p>
            <p className="text-sm text-muted-foreground">
              Les bases de données ne sont pas exposées en HTTP et ne reçoivent donc pas de
              domaine. Pour vous y connecter, utilisez l’URL de l’onglet Connexion ou l’adresse
              privée ci-dessus.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ServiceDomainsSkeleton({ className }: { className?: string }) {
  return (
    <div aria-busy="true" className={cn("space-y-8", className)}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
          <Skeleton className="h-8 w-40" />
        </div>
        <Skeleton className="h-[74px] rounded-xl" />
        <Skeleton className="h-[74px] rounded-xl" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-8 w-full rounded-lg" />
      </div>
    </div>
  );
}

export interface ServiceDomainsProps {
  serviceId: string;
  className?: string;
}

/**
 * Network section of the service panel: public domains (generate, add yours,
 * verify, change the port, delete) and the private address of the service.
 * Databases only get the private part.
 */
export function ServiceDomains({ serviceId, className }: ServiceDomainsProps) {
  const publicHeadingId = useId();
  const service = useService(serviceId);
  const domains = useDomains({ serviceId });
  const actions = useDomainActions();
  const generate = useGenerateDomain();
  const [customOpen, setCustomOpen] = useState(false);
  // The domain being edited outlives its dialog so the text holds while it closes.
  const [portTarget, setPortTarget] = useState<Domain | null>(null);
  const [portOpen, setPortOpen] = useState(false);

  if (service.isError || domains.isError) {
    return (
      <ErrorState
        compact
        error={service.error ?? domains.error}
        onRetry={() => {
          void service.refetch();
          void domains.refetch();
        }}
        className={className}
      />
    );
  }
  if (service.isPending || domains.isPending) return <ServiceDomainsSkeleton className={className} />;

  const current = service.data;
  const isDatabase = current.source.type === "postgres";

  function generateDomain() {
    generate.mutate(serviceId, {
      onSuccess: (domain) => toast.success("Domaine généré", { description: domain.hostname }),
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  }

  function editPort(domain: Domain) {
    setPortTarget(domain);
    setPortOpen(true);
  }

  return (
    <div className={cn("space-y-8", className)}>
      {isDatabase ? null : (
        <section aria-labelledby={publicHeadingId} className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id={publicHeadingId} className="text-base font-medium">
                Réseau public
              </h3>
              <p className="text-sm text-muted-foreground">
                Domaines qui exposent ce service sur Internet.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={generate.isPending}
                onClick={generateDomain}
              >
                {generate.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Sparkles data-icon="inline-start" />
                )}
                Générer un domaine
              </Button>
              <Button type="button" variant="outline" onClick={() => setCustomOpen(true)}>
                <Plus data-icon="inline-start" />
                Domaine personnalisé
              </Button>
            </div>
          </div>

          {domains.data.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong">
              <EmptyState
                compact
                icon={Globe}
                title="Aucun domaine public"
                description="Ce service n’est pas encore accessible depuis Internet. Générez un domaine ou reliez le vôtre."
              />
            </div>
          ) : (
            <FadeIn>
              <ul className="space-y-2">
                <AnimatePresence initial={false}>
                  {domains.data.map((domain) => (
                    <DomainItem
                      key={domain.id}
                      domain={domain}
                      actions={actions}
                      onEditPort={editPort}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </FadeIn>
          )}
        </section>
      )}

      <PrivateNetwork service={current} showDatabaseNote={isDatabase} />

      <DomainDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        defaultServiceId={serviceId}
        lockService
        initialMode="custom"
      />
      <EditPortDialog domain={portTarget} open={portOpen} onOpenChange={setPortOpen} />
      {actions.dialogs}
    </div>
  );
}
