"use client";

import { useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { RelativeTime } from "@/components/shared/relative-time";
import { SectionCard } from "@/components/shared/section-card";
import { TableShell } from "@/components/shared/table-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNow } from "@/hooks/use-now";
import { formatDate } from "@/lib/format";
import { useApiTokens, useRevokeApiToken } from "@/lib/queries";
import type { ApiToken } from "@/lib/types";

import { notifyError } from "../lib/errors";
import { CreateTokenDialog } from "./create-token-dialog";
import { QueryBoundary } from "./form-parts";

function Expiry({ token, now }: { token: ApiToken; now: number }) {
  if (!token.expiresAt) return <span className="text-muted-foreground">N’expire pas</span>;
  const expired = now > 0 && new Date(token.expiresAt).getTime() < now;
  return expired ? (
    <span className="text-destructive">Expiré le {formatDate(token.expiresAt)}</span>
  ) : (
    <span>{formatDate(token.expiresAt)}</span>
  );
}

function TokensSkeleton() {
  return (
    <div aria-busy className="divide-y border-t">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-40 max-w-full" />
          </div>
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

export function TokensSection() {
  const tokens = useApiTokens();
  const revoke = useRevokeApiToken();
  const now = useNow(60_000);
  const [createOpen, setCreateOpen] = useState(false);
  // A new key per opening gives the dialog a fresh form and forgets any revealed secret.
  const [createKey, setCreateKey] = useState(0);
  const [target, setTarget] = useState<ApiToken | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function confirmRevoke() {
    if (!target) return;
    try {
      await revoke.mutateAsync(target.id);
      toast.success("Jeton révoqué", { description: target.name });
      setConfirmOpen(false);
    } catch (error) {
      notifyError(error);
    }
  }

  const createButton = (
    <Button
      onClick={() => {
        setCreateKey((value) => value + 1);
        setCreateOpen(true);
      }}
    >
      <Plus data-icon="inline-start" />
      Créer un jeton
    </Button>
  );

  return (
    <>
      <SectionCard
        flush
        className="overflow-hidden"
        title="Jetons d’API"
        description="Authentifiez des scripts et des outils d’intégration continue auprès de l’API."
        actions={createButton}
      >
        <QueryBoundary query={tokens} skeleton={<TokensSkeleton />}>
          {(list) =>
            list.length === 0 ? (
              <div className="border-t">
                <EmptyState
                  compact
                  icon={KeyRound}
                  title="Aucun jeton"
                  description="Créez un jeton pour appeler l’API depuis un script."
                />
              </div>
            ) : (
              <TableShell className="rounded-none border-x-0 border-b-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nom</TableHead>
                      <TableHead className="hidden sm:table-cell">Jeton</TableHead>
                      <TableHead className="hidden lg:table-cell">Créé</TableHead>
                      <TableHead className="hidden md:table-cell">Dernière utilisation</TableHead>
                      <TableHead className="hidden md:table-cell">Expiration</TableHead>
                      <TableHead className="w-24">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((token) => (
                      <TableRow key={token.id}>
                        <TableCell>
                          <p className="truncate font-medium">{token.name}</p>
                          <p className="font-mono text-xs text-muted-foreground sm:hidden">{token.prefix}••••••••</p>
                          <p className="text-xs text-muted-foreground md:hidden">
                            <Expiry token={token} now={now} />
                          </p>
                        </TableCell>
                        <TableCell className="hidden font-mono text-[13px] text-muted-foreground sm:table-cell">
                          {token.prefix}••••••••
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">
                          {formatDate(token.createdAt)}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          <RelativeTime date={token.lastUsedAt} fallback="Jamais" />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Expiry token={token} now={now} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            aria-label={`Révoquer le jeton ${token.name}`}
                            onClick={() => {
                              setTarget(token);
                              setConfirmOpen(true);
                            }}
                          >
                            Révoquer
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableShell>
            )
          }
        </QueryBoundary>
      </SectionCard>

      <CreateTokenDialog key={createKey} open={createOpen} onOpenChange={setCreateOpen} />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title={`Révoquer ${target?.name ?? "ce jeton"}`}
        description="Les scripts qui utilisent ce jeton cesseront de fonctionner immédiatement. Cette action est irréversible."
        confirmLabel="Révoquer"
        loading={revoke.isPending}
        onConfirm={confirmRevoke}
      />
    </>
  );
}
