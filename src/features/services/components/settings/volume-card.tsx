"use client";

import { useId, useState } from "react";
import { HardDrive, Unlink } from "lucide-react";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProgressBar } from "@/components/shared/progress-bar";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatGigabytes, formatNumber } from "@/lib/format";
import type { Service, ServiceVolume } from "@/lib/types";

import { useSaveService, type FieldErrors } from "../../hooks/use-save-service";
import { CONFIG_LIMITS, parseNumber, validateMountPath } from "../../lib/config-rules";
import { SettingsCard } from "./settings-card";

const VOLUME_FIELDS = ["mountPath", "sizeGb"] as const;
const SIZE_ERROR = `La taille doit être comprise entre ${CONFIG_LIMITS.volumeGb.min} et ${CONFIG_LIMITS.volumeGb.max} Go.`;

function parseSize(text: string) {
  return parseNumber(text, { ...CONFIG_LIMITS.volumeGb, integer: false }, SIZE_ERROR);
}

function AttachVolumeCard({ service }: { service: Service }) {
  const ids = { path: useId(), size: useId() };
  const [mountPath, setMountPath] = useState("/data");
  const [size, setSize] = useState("1");
  const [errors, setErrors] = useState<FieldErrors>({});
  const { save, isPending } = useSaveService(service.id);

  function submit() {
    const pathError = validateMountPath(mountPath);
    const parsed = parseSize(size);
    if (pathError || !parsed.ok) {
      return setErrors({
        ...(pathError ? { mountPath: pathError } : {}),
        ...(!parsed.ok ? { sizeGb: parsed.error } : {}),
      });
    }
    setErrors({});
    void save(
      { volume: { mountPath: mountPath.trim(), sizeGb: parsed.value } },
      { fields: VOLUME_FIELDS, onFieldErrors: setErrors, message: "Volume attaché" },
    );
  }

  return (
    <SettingsCard
      title="Volume"
      description="Aucun volume attaché : les fichiers écrits par le conteneur disparaissent à chaque déploiement."
      dirty
      saving={isPending}
      saveLabel="Attacher un volume"
      onSubmit={submit}
      onReset={() => {
        setMountPath("/data");
        setSize("1");
        setErrors({});
      }}
    >
      <div className="grid gap-5 @md:grid-cols-[1fr_9rem]">
        <Field data-invalid={Boolean(errors.mountPath)}>
          <FieldLabel htmlFor={ids.path}>Point de montage</FieldLabel>
          <Input
            id={ids.path}
            value={mountPath}
            aria-invalid={Boolean(errors.mountPath)}
            onChange={(event) => {
              setMountPath(event.target.value);
              setErrors({});
            }}
            className="font-mono text-[13px]"
          />
          {errors.mountPath ? <FieldError>{errors.mountPath}</FieldError> : null}
        </Field>
        <Field data-invalid={Boolean(errors.sizeGb)}>
          <FieldLabel htmlFor={ids.size}>Taille (Go)</FieldLabel>
          <Input
            id={ids.size}
            inputMode="decimal"
            value={size}
            aria-invalid={Boolean(errors.sizeGb)}
            onChange={(event) => {
              setSize(event.target.value);
              setErrors({});
            }}
            className="tabular"
          />
          {errors.sizeGb ? <FieldError>{errors.sizeGb}</FieldError> : null}
        </Field>
      </div>
    </SettingsCard>
  );
}

function VolumeDetailsCard({ service, volume }: { service: Service; volume: ServiceVolume }) {
  const sizeId = useId();
  const [size, setSize] = useState(String(volume.sizeGb));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [detachOpen, setDetachOpen] = useState(false);
  const { save, isPending } = useSaveService(service.id);
  const usage = volume.sizeGb > 0 ? Math.min(100, (volume.usedGb / volume.sizeGb) * 100) : 0;

  function submit() {
    const parsed = parseSize(size);
    if (!parsed.ok) return setErrors({ sizeGb: parsed.error });
    if (parsed.value < volume.usedGb) {
      return setErrors({
        sizeGb: `La taille ne peut pas être inférieure à l’espace utilisé (${formatGigabytes(volume.usedGb)}).`,
      });
    }
    setErrors({});
    void save(
      { volume: { mountPath: volume.mountPath, sizeGb: parsed.value } },
      { fields: VOLUME_FIELDS, onFieldErrors: setErrors, message: "Volume redimensionné" },
    );
  }

  return (
    <>
      <SettingsCard
        title="Volume"
        dirty={size.trim().replace(",", ".") !== String(volume.sizeGb)}
        saving={isPending}
        onSubmit={submit}
        onReset={() => {
          setSize(String(volume.sizeGb));
          setErrors({});
        }}
        saveLabel="Redimensionner"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
            <HardDrive className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={volume.name}>
              {volume.name}
            </p>
            <p className="truncate font-mono text-xs text-muted-foreground" title={volume.mountPath}>
              {volume.mountPath}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setDetachOpen(true)}>
            <Unlink data-icon="inline-start" />
            Détacher
          </Button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Espace utilisé</span>
            <span className="tabular font-medium">
              {formatGigabytes(volume.usedGb)} sur {formatGigabytes(volume.sizeGb)}
            </span>
          </div>
          <ProgressBar
            value={usage}
            tone={usage >= 90 ? "danger" : usage >= 75 ? "warning" : "brand"}
            label="Espace utilisé du volume"
          />
        </div>

        <Field data-invalid={Boolean(errors.sizeGb)}>
          <FieldLabel htmlFor={sizeId}>Taille (Go)</FieldLabel>
          <Input
            id={sizeId}
            inputMode="decimal"
            value={size}
            aria-invalid={Boolean(errors.sizeGb)}
            onChange={(event) => {
              setSize(event.target.value);
              setErrors({});
            }}
            className="tabular w-32"
          />
          {errors.sizeGb ? (
            <FieldError>{errors.sizeGb}</FieldError>
          ) : (
            <FieldDescription>
              De {CONFIG_LIMITS.volumeGb.min} à {formatNumber(CONFIG_LIMITS.volumeGb.max)} Go, sans descendre sous l’espace utilisé.
            </FieldDescription>
          )}
        </Field>
      </SettingsCard>

      <ConfirmDialog
        open={detachOpen}
        onOpenChange={setDetachOpen}
        tone="danger"
        title="Détacher le volume"
        description={`Le volume ${volume.name} ne sera plus monté sur ${volume.mountPath}. Les fichiers qu’il contient ne seront plus accessibles au service.`}
        confirmLabel="Détacher"
        loading={isPending}
        onConfirm={async () => {
          const ok = await save(
            { volume: null },
            { fields: [], onFieldErrors: () => undefined, message: "Volume détaché" },
          );
          if (ok) setDetachOpen(false);
        }}
      />
    </>
  );
}

/** Attach, resize or detach the persistent volume of a service. */
export function VolumeCard({ service }: { service: Service }) {
  const { volume } = service;
  if (!volume) return <AttachVolumeCard key={`${service.id}:none`} service={service} />;
  return (
    <VolumeDetailsCard
      key={`${service.id}:${volume.mountPath}:${volume.sizeGb}`}
      service={service}
      volume={volume}
    />
  );
}
