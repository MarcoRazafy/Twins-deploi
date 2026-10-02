"use client";

import { useId, useState, type FormEvent } from "react";
import { CloudDownload } from "lucide-react";
import { toast } from "sonner";

import { DockerIcon } from "@/components/icons/brand-icons";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { useService, useUpdateService } from "@/lib/queries";
import { isServiceBusy } from "@/lib/status";
import type { DockerSource, Service } from "@/lib/types";

import { useRedeploy } from "../hooks/use-redeploy";
import { validateImage, validateTag } from "../lib/image-reference";

type DockerService = Service & { source: DockerSource };

function isDockerService(service: Service): service is DockerService {
  return service.source.type === "docker";
}

function SourceSkeleton() {
  return (
    <div aria-busy className="space-y-5">
      <Skeleton className="h-11 w-full rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
      <Skeleton className="h-8 w-64 rounded-lg" />
    </div>
  );
}

/** "Source" settings of a Docker service: image and tag. */
export function DockerSourceSettings({ serviceId }: { serviceId: string }) {
  const service = useService(serviceId);

  if (service.isPending) return <SourceSkeleton />;
  if (!service.data || !isDockerService(service.data)) return null;

  // The form is keyed on the saved source: a save (or a change made elsewhere) resets the draft.
  return (
    <SourceForm
      key={`${service.data.source.image}:${service.data.source.tag}`}
      service={service.data}
    />
  );
}

function SourceForm({ service }: { service: DockerService }) {
  const { source } = service;
  const ids = { image: useId(), tag: useId() };
  const update = useUpdateService();
  const { redeploy, isRedeploying } = useRedeploy(service.id);

  const [draft, setDraft] = useState<{ image: string; tag: string } | null>(null);
  const [errors, setErrors] = useState<{ image?: string; tag?: string }>({});

  const image = draft?.image ?? source.image;
  const tag = draft?.tag ?? source.tag;
  const dirty = image.trim() !== source.image || tag.trim() !== source.tag;
  const busy = isServiceBusy(service.status);

  function edit(patch: Partial<{ image: string; tag: string }>) {
    setDraft({ image, tag, ...patch });
    setErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextImage = image.trim();
    const nextTag = tag.trim();
    const next = {
      image: validateImage(nextImage) ?? undefined,
      tag: validateTag(nextTag) ?? undefined,
    };
    setErrors(next);
    if (next.image || next.tag) return;

    try {
      await update.mutateAsync({
        id: service.id,
        patch: { source: { image: nextImage, tag: nextTag } },
      });
    } catch (error) {
      if (isApiError(error) && error.field?.endsWith("image")) {
        setErrors({ image: error.message });
      } else if (isApiError(error) && error.field?.endsWith("tag")) {
        setErrors({ tag: error.message });
      } else {
        toast.error(getErrorMessage(error));
      }
      return;
    }
    toast.success("Source enregistrée", {
      description: "Redéployez pour appliquer ce changement.",
      action: { label: "Redéployer", onClick: () => void redeploy("config") },
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5">
        <DockerIcon aria-hidden className="size-5 shrink-0" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[13px]"
          title={`${source.image}:${source.tag}`}
        >
          <span className="font-medium">{source.image}</span>
          <span className="text-muted-foreground">:{source.tag}</span>
        </span>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_12rem]">
          <Field data-invalid={errors.image ? true : undefined}>
            <FieldLabel htmlFor={ids.image}>Image</FieldLabel>
            <Input
              id={ids.image}
              value={image}
              onChange={(event) => edit({ image: event.target.value })}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.image ? true : undefined}
              className="font-mono text-[13px]"
            />
            <FieldError>{errors.image}</FieldError>
          </Field>
          <Field data-invalid={errors.tag ? true : undefined}>
            <FieldLabel htmlFor={ids.tag}>Tag</FieldLabel>
            <Input
              id={ids.tag}
              value={tag}
              onChange={(event) => edit({ tag: event.target.value })}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.tag ? true : undefined}
              className="font-mono text-[13px]"
            />
            <FieldError>{errors.tag}</FieldError>
          </Field>
        </div>
        <FieldDescription>
          L’image et le tag sont utilisés au prochain déploiement : enregistrer ne redémarre rien.
        </FieldDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!dirty || update.isPending}>
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            Enregistrer
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => {
                setDraft(null);
                setErrors({});
              }}
            >
              Annuler
            </Button>
          ) : null}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button
          type="button"
          variant="secondary"
          disabled={isRedeploying || busy}
          title={busy ? "Un déploiement est déjà en cours" : undefined}
          onClick={() =>
            void redeploy("redeploy", `Dernière version de ${source.image}:${source.tag}`)
          }
        >
          {isRedeploying ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <CloudDownload data-icon="inline-start" />
          )}
          Récupérer la dernière version de l’image
        </Button>
        {busy ? (
          <span className="text-xs text-muted-foreground">Un déploiement est déjà en cours.</span>
        ) : null}
      </div>
    </div>
  );
}
