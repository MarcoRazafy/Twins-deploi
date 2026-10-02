"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";

import { SectionCard } from "@/components/shared/section-card";
import { ServiceIcon } from "@/components/shared/service-icon";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject, useService } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { Domain } from "@/lib/types";

import type { DomainActions } from "../hooks/use-domain-actions";
import { DnsRecordsPanel } from "./dns-records-panel";
import { DomainConfigSection } from "./domain-config-section";
import { DomainKindBadge, DomainQuickActions, DomainStatusBadge } from "./domain-parts";
import { DomainStepper } from "./domain-stepper";
import { NginxPreview } from "./nginx-preview";

function SheetBody({ domain, actions }: { domain: Domain; actions: DomainActions }) {
  const service = useService(domain.serviceId);
  const project = useProject(domain.projectId);

  return (
    <>
      <SheetHeader className="gap-2.5 border-b p-4 pr-14 sm:p-5 sm:pr-14">
        <div className="flex items-start gap-1">
          <SheetTitle className="min-w-0 font-mono text-[15px] leading-snug break-all">
            {domain.hostname}
          </SheetTitle>
          <DomainQuickActions hostname={domain.hostname} className="-mt-0.5" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DomainStatusBadge status={domain.status} />
          <DomainKindBadge kind={domain.kind} />
        </div>
        <SheetDescription asChild>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {service.data ? (
              <Link
                href={routes.workspace(domain.projectId, { service: domain.serviceId })}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-sm text-foreground outline-none hover:text-brand-400 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ServiceIcon type={service.data.source.type} />
                <span className="truncate">{service.data.name}</span>
              </Link>
            ) : (
              <Skeleton className="h-4 w-28" />
            )}
            {project.data ? (
              <>
                <span aria-hidden="true" className="text-subtle">
                  ·
                </span>
                <span className="truncate">{project.data.name}</span>
              </>
            ) : null}
          </div>
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <SectionCard
          title="Vérification"
          description="Avancement en direct de la mise en ligne du domaine."
        >
          <DomainStepper domain={domain} />
        </SectionCard>

        {domain.kind === "custom" ? (
          <SectionCard
            title="Enregistrements DNS à créer"
            description="Ils relient le domaine à la plateforme et prouvent que vous en êtes propriétaire."
          >
            <DnsRecordsPanel domain={domain} />
          </SectionCard>
        ) : null}

        <SectionCard title="Configuration" description="Port du service et redirection HTTPS.">
          <DomainConfigSection domain={domain} />
        </SectionCard>

        <SectionCard
          title="Configuration NGINX générée"
          description="Aperçu du bloc server que la plateforme écrira au déploiement, d’après vos réglages NGINX."
        >
          <NginxPreview domain={domain} />
        </SectionCard>

        <SectionCard
          tone="danger"
          title="Supprimer ce domaine"
          description="Le domaine cesse d’être servi immédiatement. Cette action est irréversible."
          actions={
            <Button type="button" variant="destructive" onClick={() => actions.requestDelete(domain)}>
              <Trash2 data-icon="inline-start" />
              Supprimer
            </Button>
          }
        />
      </div>
    </>
  );
}

export interface DomainDetailSheetProps {
  domain: Domain | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shared with the table so the delete confirmation exists only once. */
  actions: DomainActions;
  /**
   * Radix hands the focus back to a trigger, and this sheet has none (it opens from table rows):
   * prevent the default here and focus the control that opened it.
   */
  onCloseAutoFocus?: (event: Event) => void;
}

/** Right-hand panel (full screen on mobile) with everything about one domain. */
export function DomainDetailSheet({
  domain,
  open,
  onOpenChange,
  actions,
  onCloseAutoFocus,
}: DomainDetailSheetProps) {
  return (
    <Sheet open={open && domain !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 p-0 outline-none data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
        // The first control is the open-link: focusing it would pop its tooltip over the header.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {domain ? <SheetBody key={domain.id} domain={domain} actions={actions} /> : null}
      </SheetContent>
    </Sheet>
  );
}
