"use client";

import { useId, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CopyField } from "@/components/shared/copy-field";
import { ProgressBar } from "@/components/shared/progress-bar";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { formatMegabytes, formatPercent } from "@/lib/format";
import { useRotateDatabasePassword, useUpdateDatabase } from "@/lib/queries";
import type { Database } from "@/lib/types";

import { storagePercent, storageTone } from "../lib/database-utils";
import { DeleteDatabaseDialog } from "./delete-database-dialog";
import { DatabaseGate } from "./database-gate";
import { SettingsSkeleton } from "./panel-skeletons";

const MB_PER_GB = 1024;
const MAX_STORAGE_GB = 100;
const MIN_CONNECTIONS = 10;
const MAX_CONNECTIONS = 500;

export interface DatabaseSettingsPanelProps {
  databaseId: string;
  /** Called after the database is deleted (the detail page navigates back to the list). */
  onDeleted?: () => void;
}

/** Storage, connections, public networking, password rotation and deletion. */
export function DatabaseSettingsPanel({ databaseId, onDeleted }: DatabaseSettingsPanelProps) {
  return (
    <DatabaseGate databaseId={databaseId} skeleton={<SettingsSkeleton />}>
      {(database) => <SettingsContent database={database} onDeleted={onDeleted} />}
    </DatabaseGate>
  );
}

function StorageSection({ database }: { database: Database }) {
  const update = useUpdateDatabase();
  const [draftGb, setDraftGb] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const percent = storagePercent(database);
  const currentGb = database.storageLimitMb / MB_PER_GB;
  // The volume cannot shrink below what it already holds.
  const minGb = Math.max(1, Math.ceil(database.storageUsedMb / MB_PER_GB));
  const maxGb = Math.max(MAX_STORAGE_GB, Math.ceil(currentGb));
  const valueGb = draftGb ?? currentGb;
  const dirty = draftGb !== null && draftGb !== currentGb;

  function save() {
    if (draftGb === null) return;
    update.mutate(
      { id: database.id, patch: { storageLimitMb: Math.round(draftGb * MB_PER_GB) } },
      {
        onSuccess: () => {
          toast.success("Stockage mis à jour", { description: `${draftGb} Go pour ${database.name}` });
          setDraftGb(null);
          setError(null);
        },
        onError: (apiError) => {
          if (isApiError(apiError) && apiError.field === "storageLimitMb") {
            setError(apiError.message);
          } else {
            toast.error(getErrorMessage(apiError));
          }
        },
      },
    );
  }

  return (
    <SectionCard
      title="Stockage"
      description="Taille du volume de la base. Elle peut être agrandie ou réduite, sans descendre sous l’espace déjà utilisé."
      footer={
        <>
          <span>Minimum : {minGb} Go (espace utilisé)</span>
          <Button size="sm" disabled={!dirty || update.isPending} onClick={save}>
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Utilisation actuelle</span>
            <span className="tabular font-medium">
              {formatMegabytes(database.storageUsedMb)} / {formatMegabytes(database.storageLimitMb)}{" "}
              <span className="text-muted-foreground">({formatPercent(percent, 0)})</span>
            </span>
          </div>
          <ProgressBar
            value={percent}
            tone={storageTone(percent)}
            label={`Stockage utilisé : ${formatPercent(percent, 0)}`}
          />
        </div>

        <Field data-invalid={error ? true : undefined}>
          <div className="flex items-baseline justify-between gap-2">
            <FieldLabel id={`storage-label-${database.id}`}>Taille du volume</FieldLabel>
            <span className="tabular text-sm font-medium">{Math.round(valueGb * 10) / 10} Go</span>
          </div>
          <Slider
            aria-label="Taille du volume en Go"
            min={Math.min(minGb, maxGb)}
            max={maxGb}
            step={1}
            value={[Math.max(valueGb, minGb)]}
            onValueChange={([next]) => {
              setDraftGb(next);
              setError(null);
            }}
            disabled={update.isPending || minGb >= maxGb}
            className="py-2"
          />
          <FieldError>{error}</FieldError>
        </Field>
      </div>
    </SectionCard>
  );
}

function ConnectionsSection({ database }: { database: Database }) {
  const id = useId();
  const update = useUpdateDatabase();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const value = draft ?? String(database.maxConnections);
  const parsed = Number(value);
  const dirty = draft !== null && parsed !== database.maxConnections;
  const percent = database.maxConnections > 0 ? (database.connections / database.maxConnections) * 100 : 0;

  function save() {
    if (!Number.isInteger(parsed) || parsed < MIN_CONNECTIONS || parsed > MAX_CONNECTIONS) {
      setError(`Entrez un nombre entier entre ${MIN_CONNECTIONS} et ${MAX_CONNECTIONS}.`);
      return;
    }
    update.mutate(
      { id: database.id, patch: { maxConnections: parsed } },
      {
        onSuccess: () => {
          toast.success("Limite de connexions mise à jour", { description: `${parsed} connexions` });
          setDraft(null);
          setError(null);
        },
        onError: (apiError) => {
          if (isApiError(apiError) && apiError.field === "maxConnections") setError(apiError.message);
          else toast.error(getErrorMessage(apiError));
        },
      },
    );
  }

  return (
    <SectionCard
      title="Connexions"
      description="Nombre maximal de connexions simultanées acceptées par PostgreSQL."
      footer={
        <>
          <span>
            De {MIN_CONNECTIONS} à {MAX_CONNECTIONS} connexions
          </span>
          <Button size="sm" disabled={!dirty || update.isPending} onClick={save}>
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Connexions actives</span>
            <span className="tabular font-medium">
              {database.connections} / {database.maxConnections}
            </span>
          </div>
          <ProgressBar value={percent} tone={storageTone(percent)} label="Connexions utilisées" />
        </div>
        <Field data-invalid={error ? true : undefined} className="max-w-48">
          <FieldLabel htmlFor={id}>Connexions maximales</FieldLabel>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={MIN_CONNECTIONS}
            max={MAX_CONNECTIONS}
            step={1}
            value={value}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && dirty) save();
            }}
            aria-invalid={error ? true : undefined}
            disabled={update.isPending}
            className="tabular"
          />
          <FieldError>{error}</FieldError>
        </Field>
      </div>
    </SectionCard>
  );
}

function NetworkSection({ database }: { database: Database }) {
  const id = useId();
  const update = useUpdateDatabase();
  // Shows the requested state right away, until the refetch confirms it.
  const checked = update.isPending
    ? (update.variables.patch.publicNetworking ?? database.publicNetworking)
    : database.publicNetworking;

  function toggle(next: boolean) {
    update.mutate(
      { id: database.id, patch: { publicNetworking: next } },
      {
        onSuccess: () =>
          toast.success(next ? "Réseau public activé" : "Réseau public désactivé", {
            description: database.name,
          }),
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  return (
    <SectionCard
      title="Réseau public"
      description="Expose la base sur Internet via un proxy TCP. Désactivé, elle n’est joignable que depuis les services du projet."
      actions={
        <>
          <label htmlFor={id} className="sr-only">
            Réseau public
          </label>
          {update.isPending ? <Spinner aria-label="Mise à jour du réseau" /> : null}
          <Switch id={id} checked={checked} disabled={update.isPending} onCheckedChange={toggle} />
        </>
      }
    >
      {checked && database.publicUrl ? (
        <div className="space-y-2">
          <CopyField label="URL publique" value={database.publicUrl} mono secret />
          <FieldDescription>
            Toute personne disposant de cette URL peut tenter de se connecter : gardez le mot de
            passe secret.
          </FieldDescription>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {checked ? "Création du proxy public…" : "Aucune URL publique : le réseau public est désactivé."}
        </p>
      )}
    </SectionCard>
  );
}

function CredentialsSection({ database }: { database: Database }) {
  const rotate = useRotateDatabasePassword();
  const [open, setOpen] = useState(false);

  return (
    <SectionCard
      title="Identifiants"
      description="Régénérer le mot de passe invalide l’ancien immédiatement. Le nom d’utilisateur ne change pas."
      actions={
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <KeyRound data-icon="inline-start" />
          Régénérer le mot de passe
        </Button>
      }
    >
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title="Régénérer le mot de passe"
        description="L’ancien mot de passe cessera de fonctionner immédiatement. Les connexions qui l’utilisent encore seront refusées."
        confirmLabel="Régénérer"
        loading={rotate.isPending}
        onConfirm={() =>
          rotate.mutate(database.id, {
            onSuccess: () => {
              toast.success("Mot de passe régénéré", {
                description:
                  "Redéployez les services qui utilisent la variable de référence DATABASE_URL pour qu’ils prennent en compte le nouveau mot de passe.",
                duration: 10_000,
              });
              setOpen(false);
            },
            onError: (error) => toast.error(getErrorMessage(error)),
          })
        }
      />
      <p className="text-sm text-muted-foreground">
        Les services qui référencent la base avec <span className="font-mono text-[13px]">{`\${{${database.name}.DATABASE_URL}}`}</span>{" "}
        doivent être redéployés après la rotation.
      </p>
    </SectionCard>
  );
}

function DangerSection({ database, onDeleted }: { database: Database; onDeleted?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <SectionCard
      tone="danger"
      title="Zone de danger"
      description="La suppression de la base est définitive : son volume, ses sauvegardes et ses connexions disparaissent avec elle."
      actions={
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          <Trash2 data-icon="inline-start" />
          Supprimer la base
        </Button>
      }
    >
      <DeleteDatabaseDialog database={database} open={open} onOpenChange={setOpen} onDeleted={onDeleted} />
    </SectionCard>
  );
}

function SettingsContent({
  database,
  onDeleted,
}: {
  database: Database;
  onDeleted?: () => void;
}) {
  return (
    <div className="@container space-y-4">
      <StorageSection database={database} />
      <ConnectionsSection database={database} />
      <NetworkSection database={database} />
      <CredentialsSection database={database} />
      <DangerSection database={database} onDeleted={onDeleted} />
    </div>
  );
}
