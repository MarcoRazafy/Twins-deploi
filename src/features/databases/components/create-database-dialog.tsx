"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";

import { ProgressBar } from "@/components/shared/progress-bar";
import { ProjectSelect } from "@/components/shared/project-select";
import { ServiceSelect } from "@/components/shared/service-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { POSTGRES_VERSIONS } from "@/lib/constants";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { useCreateDatabase, useService } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { Database, ServiceType } from "@/lib/types";

import { SegmentedControl } from "./segmented-control";
import { SubmitButton } from "./submit-button";

const DEFAULT_NAME = "Postgres";
const DEFAULT_VERSION = POSTGRES_VERSIONS[0];
const RECOMMENDED_VERSION = POSTGRES_VERSIONS[0];
const DEFAULT_STORAGE_GB = 5;
const MIN_STORAGE_GB = 1;
const MAX_STORAGE_GB = 50;
const MAX_NAME_LENGTH = 40;
/** Only deployable services consume a database. */
const CONSUMER_TYPES: ServiceType[] = ["github", "docker"];

export interface CreateDatabaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  /** Preselects a service to connect the new database to. */
  connectToServiceId?: string;
  onCreated?: (database: Database) => void;
}

interface FormDraft {
  projectId: string | null;
  name: string;
  version: string;
  storageGb: number;
  publicNetworking: boolean;
  serviceId: string | null;
}

type FormErrors = Partial<Record<"projectId" | "name", string>>;

/**
 * Creation form of a PostgreSQL database. Without `onCreated`, the user lands
 * on the page of the new database.
 */
export function CreateDatabaseDialog({
  open,
  onOpenChange,
  defaultProjectId,
  connectToServiceId,
  onCreated,
}: CreateDatabaseDialogProps) {
  // Owned here, not by the form: the form unmounts with the dialog content, and
  // a closed dialog would silently drop the result of a request still running.
  const create = useCreateDatabase();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <CreateDatabaseForm
          create={create}
          defaultProjectId={defaultProjectId}
          connectToServiceId={connectToServiceId}
          onClose={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      </DialogContent>
    </Dialog>
  );
}

interface CreateDatabaseFormProps {
  create: ReturnType<typeof useCreateDatabase>;
  defaultProjectId?: string;
  connectToServiceId?: string;
  onClose: () => void;
  onCreated?: (database: Database) => void;
}

// Rendered inside the dialog content, which unmounts on close: every opening
// starts from a blank form.
function CreateDatabaseForm({
  create,
  defaultProjectId,
  connectToServiceId,
  onClose,
  onCreated,
}: CreateDatabaseFormProps) {
  const router = useRouter();
  const ids = useId();
  const [draft, setDraft] = useState<Partial<FormDraft>>({});
  const [errors, setErrors] = useState<FormErrors>({});

  // The project of the preselected service wins when no project was given.
  const preselected = useService(defaultProjectId ? null : connectToServiceId);
  const values: FormDraft = {
    projectId:
      draft.projectId !== undefined
        ? draft.projectId
        : (defaultProjectId ?? preselected.data?.projectId ?? null),
    name: draft.name ?? DEFAULT_NAME,
    version: draft.version ?? DEFAULT_VERSION,
    storageGb: draft.storageGb ?? DEFAULT_STORAGE_GB,
    publicNetworking: draft.publicNetworking ?? false,
    serviceId: draft.serviceId !== undefined ? draft.serviceId : (connectToServiceId ?? null),
  };

  function patch(next: Partial<FormDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setErrors((current) => {
      const copy = { ...current };
      if (next.projectId !== undefined) delete copy.projectId;
      if (next.name !== undefined) delete copy.name;
      return copy;
    });
  }

  function validateName(name: string): string | undefined {
    const trimmed = name.trim();
    if (!trimmed) return "Donnez un nom à la base.";
    if (trimmed.length > MAX_NAME_LENGTH) {
      return `Le nom ne peut pas dépasser ${MAX_NAME_LENGTH} caractères.`;
    }
    return undefined;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;

    const found: FormErrors = {};
    if (!values.projectId) found.projectId = "Choisissez le projet qui accueillera la base.";
    const nameError = validateName(values.name);
    if (nameError) found.name = nameError;
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    if (!values.projectId) return;

    create.mutate(
      {
        projectId: values.projectId,
        name: values.name.trim(),
        version: values.version,
        storageGb: values.storageGb,
        publicNetworking: values.publicNetworking,
        connectToServiceId: values.serviceId ?? undefined,
      },
      {
        onSuccess: (database) => {
          toast.success("Base de données créée", {
            description: values.serviceId
              ? `${database.name} · connectée, variable DATABASE_URL ajoutée`
              : database.name,
          });
          onClose();
          if (onCreated) onCreated(database);
          else router.push(routes.database(database.id));
        },
        onError: (error) => {
          if (isApiError(error) && (error.field === "name" || error.field === "projectId")) {
            setErrors({ [error.field]: error.message });
            return;
          }
          toast.error(getErrorMessage(error));
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Nouvelle base de données</DialogTitle>
        <DialogDescription>
          Une base PostgreSQL gérée, avec son volume, déployée dans le réseau privé du projet.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-invalid={errors.projectId ? true : undefined}>
          <FieldLabel htmlFor={`${ids}-project`}>Projet</FieldLabel>
          <ProjectSelect
            id={`${ids}-project`}
            value={values.projectId}
            onChange={(projectId) => patch({ projectId, serviceId: null })}
            className="w-full"
            disabled={create.isPending}
          />
          <FieldError>{errors.projectId}</FieldError>
        </Field>

        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={`${ids}-name`}>Nom</FieldLabel>
          <Input
            id={`${ids}-name`}
            value={values.name}
            onChange={(event) => patch({ name: event.target.value })}
            onBlur={() => {
              const message = validateName(values.name);
              if (message) setErrors((current) => ({ ...current, name: message }));
            }}
            aria-invalid={errors.name ? true : undefined}
            autoComplete="off"
            spellCheck={false}
            disabled={create.isPending}
          />
          <FieldError>{errors.name}</FieldError>
        </Field>

        <Field>
          <FieldLabel id={`${ids}-version`}>Version</FieldLabel>
          <SegmentedControl
            label="Version de PostgreSQL"
            value={values.version}
            onValueChange={(version) => patch({ version })}
            disabled={create.isPending}
            options={POSTGRES_VERSIONS.map((version) => ({
              value: version,
              label: version === RECOMMENDED_VERSION ? `${version} · recommandée` : version,
            }))}
          />
        </Field>

        <Field>
          <div className="flex items-baseline justify-between gap-2">
            <FieldLabel htmlFor={`${ids}-storage`}>Stockage</FieldLabel>
            <span className="tabular text-sm font-medium">{values.storageGb} Go</span>
          </div>
          <Slider
            id={`${ids}-storage`}
            aria-label="Stockage en Go"
            min={MIN_STORAGE_GB}
            max={MAX_STORAGE_GB}
            step={1}
            value={[values.storageGb]}
            onValueChange={([storageGb]) => patch({ storageGb })}
            disabled={create.isPending}
            className="py-2"
          />
          <FieldDescription>
            De {MIN_STORAGE_GB} à {MAX_STORAGE_GB} Go. Le volume pourra être agrandi plus tard
            dans les réglages.
          </FieldDescription>
        </Field>

        <Field orientation="horizontal" className="items-start justify-between gap-4">
          <div className="space-y-1">
            <FieldLabel htmlFor={`${ids}-public`}>Réseau public</FieldLabel>
            <FieldDescription>
              Expose la base sur Internet via un proxy TCP. Sans cela, elle n’est joignable que
              depuis les services du projet.
            </FieldDescription>
          </div>
          <Switch
            id={`${ids}-public`}
            checked={values.publicNetworking}
            onCheckedChange={(publicNetworking) => patch({ publicNetworking })}
            disabled={create.isPending}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={`${ids}-service`}>Connecter à un service (optionnel)</FieldLabel>
          <div className="flex items-center gap-2">
            <ServiceSelect
              id={`${ids}-service`}
              projectId={values.projectId}
              types={CONSUMER_TYPES}
              value={values.serviceId}
              onChange={(serviceId) => patch({ serviceId })}
              placeholder={values.projectId ? "Aucun service" : "Choisissez d’abord un projet"}
              className="w-full min-w-0 flex-1"
              disabled={create.isPending || !values.projectId}
            />
            {values.serviceId ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Ne pas connecter de service"
                onClick={() => patch({ serviceId: null })}
                disabled={create.isPending}
              >
                <X />
              </Button>
            ) : null}
          </div>
          <FieldDescription>
            Crée la connexion sur le canvas et une variable de référence DATABASE_URL sur ce
            service.
          </FieldDescription>
        </Field>
      </FieldGroup>

      {create.isPending ? (
        <div role="status" className="space-y-1.5">
          <ProgressBar indeterminate label="Création de la base en cours" />
          <p className="text-xs text-muted-foreground">
            Création du volume et déploiement de PostgreSQL {values.version}…
          </p>
        </div>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="max-sm:h-10"
          disabled={create.isPending}
          onClick={onClose}
        >
          Annuler
        </Button>
        <SubmitButton pending={create.isPending}>Créer la base</SubmitButton>
      </DialogFooter>
    </form>
  );
}
