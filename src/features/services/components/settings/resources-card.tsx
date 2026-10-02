"use client";

import { useMemo, useState } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { formatMegabytes, formatNumber } from "@/lib/format";
import type { Service } from "@/lib/types";

import { useSaveService, type FieldErrors } from "../../hooks/use-save-service";
import { CONFIG_LIMITS, memoryStops } from "../../lib/config-rules";
import { SettingsCard } from "./settings-card";

/** CPU and memory limits of the container. */
export function ResourcesCard({ service }: { service: Service }) {
  const { cpuLimit, memoryLimitMb } = service.config;
  const stops = useMemo(() => memoryStops(memoryLimitMb), [memoryLimitMb]);
  const [cpu, setCpu] = useState(cpuLimit);
  const [memory, setMemory] = useState(memoryLimitMb);
  const [errors, setErrors] = useState<FieldErrors>({});
  const { save, isPending } = useSaveService(service.id);

  const memoryIndex = Math.max(0, stops.indexOf(memory));

  return (
    <SettingsCard
      title="Limites du conteneur"
      description="Plafonds de CPU et de mémoire appliqués à chaque réplica."
      dirty={cpu !== cpuLimit || memory !== memoryLimitMb}
      saving={isPending}
      onSubmit={() => {
        setErrors({});
        void save(
          { config: { cpuLimit: cpu, memoryLimitMb: memory } },
          { fields: ["cpuLimit", "memoryLimitMb"], onFieldErrors: setErrors },
        );
      }}
      onReset={() => {
        setCpu(cpuLimit);
        setMemory(memoryLimitMb);
        setErrors({});
      }}
    >
      <Field data-invalid={Boolean(errors.cpuLimit)}>
        <div className="flex items-baseline justify-between gap-3">
          <FieldLabel>Limite de CPU</FieldLabel>
          <span className="tabular text-sm font-medium">{formatNumber(cpu)} vCPU</span>
        </div>
        <Slider
          value={[cpu]}
          min={CONFIG_LIMITS.cpu.min}
          max={CONFIG_LIMITS.cpu.max}
          step={CONFIG_LIMITS.cpu.step}
          onValueChange={([value]) => {
            setCpu(value);
            setErrors({});
          }}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatNumber(CONFIG_LIMITS.cpu.min)} vCPU</span>
          <span>{formatNumber(CONFIG_LIMITS.cpu.max)} vCPU</span>
        </div>
        {errors.cpuLimit ? <FieldError>{errors.cpuLimit}</FieldError> : null}
      </Field>

      <Field data-invalid={Boolean(errors.memoryLimitMb)}>
        <div className="flex items-baseline justify-between gap-3">
          <FieldLabel>Limite de mémoire</FieldLabel>
          <span className="tabular text-sm font-medium">{formatMegabytes(memory)}</span>
        </div>
        <Slider
          value={[memoryIndex]}
          min={0}
          max={stops.length - 1}
          step={1}
          onValueChange={([index]) => {
            setMemory(stops[index] ?? memoryLimitMb);
            setErrors({});
          }}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatMegabytes(stops[0])}</span>
          <span>{formatMegabytes(stops[stops.length - 1])}</span>
        </div>
        {errors.memoryLimitMb ? (
          <FieldError>{errors.memoryLimitMb}</FieldError>
        ) : (
          <FieldDescription>
            Un dépassement redémarre le conteneur. Valeurs de 128 Mo à 16 Go.
          </FieldDescription>
        )}
      </Field>
    </SettingsCard>
  );
}
