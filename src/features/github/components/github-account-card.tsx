"use client";

import { useState } from "react";
import { Building2, Unplug, User } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RelativeTime } from "@/components/shared/relative-time";
import { StatusDot } from "@/components/shared/status-badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api/contract";
import { useDisconnectGithub } from "@/lib/queries";
import type { GithubConnection } from "@/lib/types";

export interface GithubAccountCardProps {
  connection: GithubConnection;
}

/** The connected account: identity, organisations, granted scopes, disconnect. */
export function GithubAccountCard({ connection }: GithubAccountCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const disconnect = useDisconnectGithub();
  const { account, organizations, scopes } = connection;

  if (!account) return null;

  async function handleDisconnect() {
    try {
      await disconnect.mutateAsync();
      setConfirmOpen(false);
      toast.success("GitHub déconnecté", {
        description: "Vos services restent en ligne, le déploiement automatique est suspendu.",
      });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <section
      aria-label="Compte GitHub connecté"
      className="surface-highlight rounded-xl border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <UserAvatar name={account.name} size="lg" />
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-medium">{account.login}</h2>
            <Badge variant="secondary">
              <User data-icon="inline-start" />
              Compte personnel
            </Badge>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span className="truncate">{account.name}</span>
            <span aria-hidden className="text-subtle">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone="success" />
              <RelativeTime date={connection.connectedAt} prefix="Connecté" />
            </span>
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
          <Unplug data-icon="inline-start" />
          Déconnecter
        </Button>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 border-t pt-4 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Organisations</dt>
        <dd className="flex flex-wrap gap-2">
          {organizations.length === 0 ? (
            <span className="text-muted-foreground">Aucune organisation</span>
          ) : (
            organizations.map((organization) => (
              <span
                key={organization.id}
                title={organization.name}
                className="inline-flex items-center gap-2 rounded-lg bg-secondary px-2.5 py-1"
              >
                <Building2 aria-hidden className="size-4 text-muted-foreground" />
                <span className="font-medium">{organization.login}</span>
                <Badge variant="outline">Organisation</Badge>
              </span>
            ))
          )}
        </dd>

        <dt className="text-muted-foreground">Autorisations</dt>
        <dd className="flex flex-wrap gap-1.5">
          {scopes.length === 0 ? (
            <span className="text-muted-foreground">Aucune autorisation</span>
          ) : (
            scopes.map((scope) => (
              <Badge key={scope} variant="outline" className="font-mono text-[11px]">
                {scope}
              </Badge>
            ))
          )}
        </dd>
      </dl>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title="Déconnecter GitHub"
        description={`Le compte ${account.login} sera déconnecté. Vos services déjà déployés continuent de fonctionner, mais le déploiement automatique à chaque push s’arrête et vous ne pourrez plus importer de dépôt tant que GitHub n’est pas reconnecté.`}
        confirmLabel="Déconnecter"
        onConfirm={handleDisconnect}
      />
    </section>
  );
}
