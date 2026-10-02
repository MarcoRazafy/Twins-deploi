"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeCheck, Rocket } from "lucide-react";
import { toast } from "sonner";

import { DockerIcon } from "@/components/icons/brand-icons";
import { ProjectSelect } from "@/components/shared/project-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { useDeployImage, useProjects } from "@/lib/queries";
import { routes } from "@/lib/routes";
import type { Service } from "@/lib/types";
import { useUiStore } from "@/stores/ui-store";

import {
  defaultServiceName,
  validateEnvRows,
  validateImage,
  validatePort,
  validateServiceName,
  validateTag,
  type EnvRow,
  type ImageSelection,
} from "../lib/image-reference";
import { EnvVariableRows } from "./env-variable-rows";

type FieldName = "image" | "tag" | "name" | "port" | "project";
type FieldErrors = Partial<Record<FieldName, string>>;

const INLINE_FIELDS: readonly string[] = ["image", "tag", "name", "port"];

export interface ImageConfigureStepProps {
  selection: ImageSelection;
  defaultProjectId: string | undefined;
  onBack: () => void;
  onDeployed: (service: Service) => void;
}

/** Step 2: tag, name, project, port and environment variables. */
export function ImageConfigureStep({
  selection,
  defaultProjectId,
  onBack,
  onDeployed,
}: ImageConfigureStepProps) {
  const router = useRouter();
  const ids = { tag: useId(), name: useId(), project: useId(), port: useId() };
  const projects = useProjects();
  const lastProjectId = useUiStore((state) => state.lastProjectId);
  const deploy = useDeployImage();

  const [tag, setTag] = useState(selection.tag);
  const [name, setName] = useState(() => defaultServiceName(selection.image));
  const [port, setPort] = useState(() => String(selection.port));
  const [pickedProject, setPickedProject] = useState<string | null>(null);
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});

  const knownProjects = projects.data ?? [];
  const lastIsValid = knownProjects.some((project) => project.id === lastProjectId);
  const projectId =
    pickedProject ??
    defaultProjectId ??
    (lastIsValid ? lastProjectId : null) ??
    knownProjects[0]?.id ??
    null;

  const tagOptions = selection.hub
    ? [...new Set([selection.hub.defaultTag, ...selection.hub.tags, selection.tag])]
    : null;

  function clearError(field: FieldName) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTag = tag.trim();
    const env = validateEnvRows(rows);
    const next: FieldErrors = {
      image: validateImage(selection.image) ?? undefined,
      tag: validateTag(trimmedTag) ?? undefined,
      name: validateServiceName(name) ?? undefined,
      port: validatePort(port) ?? undefined,
      project: projectId ? undefined : "Choisissez un projet.",
    };
    setErrors(next);
    setRowErrors(env.errors);
    if (Object.values(next).some(Boolean) || Object.keys(env.errors).length > 0 || !projectId) {
      return;
    }

    try {
      const service = await deploy.mutateAsync({
        projectId,
        image: selection.image,
        tag: trimmedTag,
        name: name.trim(),
        port: Number(port),
        variables: env.variables,
      });
      const deploymentId = service.latestDeploymentId;
      toast.success(`Déploiement de ${service.name} lancé`, {
        description: `Image ${selection.image}:${trimmedTag}`,
        action: deploymentId
          ? {
              label: "Voir le déploiement",
              onClick: () => router.push(routes.deployment(deploymentId)),
            }
          : undefined,
      });
      onDeployed(service);
    } catch (error) {
      if (isApiError(error) && error.field && INLINE_FIELDS.includes(error.field)) {
        setErrors({ [error.field]: error.message });
      } else {
        toast.error(getErrorMessage(error));
      }
    }
  }

  const pending = deploy.isPending;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field data-invalid={errors.image ? true : undefined}>
        <FieldLabel>Image</FieldLabel>
        <div className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5">
          <DockerIcon aria-hidden className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={selection.image}>
            {selection.image}
          </span>
          {selection.hub?.official ? (
            <Badge variant="outline" className="border-brand-800 bg-brand-600/10 text-brand-400">
              <BadgeCheck data-icon="inline-start" />
              Officielle
            </Badge>
          ) : (
            <Badge variant="secondary">Personnalisée</Badge>
          )}
        </div>
        <FieldError>{errors.image}</FieldError>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field data-invalid={errors.tag ? true : undefined}>
          <FieldLabel htmlFor={ids.tag}>Tag</FieldLabel>
          {tagOptions ? (
            <Select
              value={tag}
              onValueChange={(value) => {
                setTag(value);
                clearError("tag");
              }}
            >
              <SelectTrigger id={ids.tag} className="w-full font-mono text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tagOptions.map((option) => (
                  <SelectItem key={option} value={option} className="font-mono text-[13px]">
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={ids.tag}
              value={tag}
              onChange={(event) => {
                setTag(event.target.value);
                clearError("tag");
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.tag ? true : undefined}
              className="font-mono text-[13px]"
            />
          )}
          <FieldError>{errors.tag}</FieldError>
        </Field>

        <Field data-invalid={errors.port ? true : undefined}>
          <FieldLabel htmlFor={ids.port}>Port</FieldLabel>
          <Input
            id={ids.port}
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => {
              setPort(event.target.value);
              clearError("port");
            }}
            aria-invalid={errors.port ? true : undefined}
            className="tabular font-mono text-[13px]"
          />
          <FieldError>{errors.port}</FieldError>
        </Field>

        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={ids.name}>Nom du service</FieldLabel>
          <Input
            id={ids.name}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              clearError("name");
            }}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
          />
          <FieldError>{errors.name}</FieldError>
        </Field>

        <Field data-invalid={errors.project ? true : undefined}>
          <FieldLabel htmlFor={ids.project}>Projet</FieldLabel>
          <ProjectSelect
            id={ids.project}
            value={projectId}
            onChange={(value) => {
              setPickedProject(value);
              clearError("project");
            }}
            className="w-full"
          />
          <FieldError>{errors.project}</FieldError>
        </Field>
      </div>

      <Field>
        <FieldLabel>Variables d’environnement</FieldLabel>
        <FieldDescription>
          Optionnel. Les clés commencent par une lettre ou « _ » et ne contiennent que des lettres,
          chiffres et « _ ».
        </FieldDescription>
        <EnvVariableRows
          rows={rows}
          onRowsChange={setRows}
          errors={rowErrors}
          onErrorsChange={setRowErrors}
          disabled={pending}
        />
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          Retour
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : <Rocket data-icon="inline-start" />}
          Déployer
        </Button>
      </DialogFooter>
    </form>
  );
}
