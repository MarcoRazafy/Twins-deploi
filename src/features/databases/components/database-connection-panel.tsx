"use client";

import { useState } from "react";
import { Eye, EyeOff, Globe, Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { CodeBlock } from "@/components/shared/code-block";
import { CopyButton } from "@/components/shared/copy-button";
import { CopyField } from "@/components/shared/copy-field";
import { SectionCard } from "@/components/shared/section-card";
import { UnderlineTabs } from "@/components/shared/underline-tabs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/lib/api/contract";
import { useUpdateDatabase } from "@/lib/queries";
import type { Database } from "@/lib/types";

import {
  SNIPPETS,
  SNIPPET_ORDER,
  maskPassword,
  referenceVariable,
  type SnippetId,
} from "../lib/connection";
import { DatabaseGate } from "./database-gate";
import { ConnectionSkeleton } from "./panel-skeletons";
import { SegmentedControl } from "./segmented-control";

const SNIPPET_TABS = SNIPPET_ORDER.map((id) => ({ value: id, label: SNIPPETS[id].label }));

type Network = "private" | "public";

/** Connection strings, individual credentials, reference variable and code snippets. */
export function DatabaseConnectionPanel({ databaseId }: { databaseId: string }) {
  return (
    <DatabaseGate databaseId={databaseId} skeleton={<ConnectionSkeleton />}>
      {(database) => <ConnectionContent database={database} />}
    </DatabaseGate>
  );
}

function PublicUrlSection({ database }: { database: Database }) {
  const update = useUpdateDatabase();

  function enable() {
    update.mutate(
      { id: database.id, patch: { publicNetworking: true } },
      {
        onSuccess: () => toast.success("Réseau public activé", { description: database.name }),
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  return (
    <SectionCard
      title="URL publique"
      description="Pour vous connecter depuis votre machine ou un service hors du projet, via le proxy TCP."
    >
      {database.publicNetworking && database.publicUrl ? (
        <div className="space-y-2">
          <CopyField value={database.publicUrl} mono secret />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
            La base est exposée sur Internet : gardez le mot de passe secret et préférez l’URL
            privée entre services du projet.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg bg-secondary px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Globe className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Le réseau public est désactivé : la base n’est joignable que depuis le projet.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 max-sm:h-9"
            disabled={update.isPending}
            onClick={enable}
          >
            {update.isPending ? <Spinner data-icon="inline-start" /> : <Globe data-icon="inline-start" />}
            Activer le réseau public
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

function SnippetsSection({ database }: { database: Database }) {
  const [snippetId, setSnippetId] = useState<SnippetId>("psql");
  const [network, setNetwork] = useState<Network>("private");
  const [revealed, setRevealed] = useState(false);

  const publicAvailable = database.publicNetworking && database.publicUrl !== null;
  const url = network === "public" && publicAvailable ? (database.publicUrl ?? "") : database.internalUrl;
  const snippet = SNIPPETS[snippetId];
  const real = snippet.build(url);
  const shown = revealed ? real : maskPassword(real, database.password);

  return (
    <SectionCard
      title="Se connecter"
      description="Exemples prêts à l’emploi avec les valeurs de cette base."
      actions={
        publicAvailable ? (
          <SegmentedControl<Network>
            size="sm"
            label="Réseau utilisé dans les exemples"
            value={network}
            onValueChange={setNetwork}
            options={[
              { value: "private", label: "Privé", icon: Lock },
              { value: "public", label: "Public", icon: Globe },
            ]}
          />
        ) : undefined
      }
    >
      <div className="space-y-3">
        <UnderlineTabs
          tabs={SNIPPET_TABS}
          value={snippetId}
          onValueChange={setSnippetId}
          label="Langage de l’exemple"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{snippet.hint}</p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={revealed}
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
              {revealed ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            </Button>
            {/* The block itself is not copyable: its text may be masked, the copy never is. */}
            <CopyButton value={real} label="Copier" />
          </div>
        </div>
        <CodeBlock code={shown} title={snippet.file} copyable={false} wrap />
      </div>
    </SectionCard>
  );
}

function ConnectionContent({ database }: { database: Database }) {
  return (
    <div className="@container space-y-4">
      <SectionCard
        title="URL de connexion privée"
        description="À utiliser entre les services d’un même projet : le trafic ne quitte pas le réseau privé."
      >
        <div className="space-y-2">
          <CopyField value={database.internalUrl} mono secret />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Accessible uniquement depuis l’intérieur du réseau du projet.
          </p>
        </div>
      </SectionCard>

      <PublicUrlSection database={database} />

      <SectionCard
        title="Identifiants"
        description="Les paramètres de connexion, un par un, pour les clients qui n’acceptent pas d’URL."
      >
        <div className="grid gap-3 @xl:grid-cols-2">
          <CopyField label="Hôte" value={database.host} mono />
          <CopyField label="Port" value={String(database.port)} mono />
          <CopyField label="Base" value={database.database} mono />
          <CopyField label="Utilisateur" value={database.username} mono />
          <CopyField label="Mot de passe" value={database.password} mono secret className="@xl:col-span-2" />
        </div>
      </SectionCard>

      <SectionCard
        title="Variable de référence"
        description={
          <>
            Déclarez cette variable dans un autre service du projet : elle est résolue au
            déploiement avec l’URL privée, et suit automatiquement les changements de mot de
            passe après un redéploiement.
          </>
        }
      >
        <CodeBlock
          code={referenceVariable(database)}
          title="Variable d’environnement"
          language="env"
        />
      </SectionCard>

      <SnippetsSection database={database} />
    </div>
  );
}
