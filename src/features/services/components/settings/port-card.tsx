"use client";

import { useId, useState } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Service } from "@/lib/types";

import { useSaveService, type FieldErrors } from "../../hooks/use-save-service";
import { parsePort } from "../../lib/config-rules";
import { SettingsCard } from "./settings-card";

/** Container port the platform proxies public traffic to. */
export function PortCard({ service }: { service: Service }) {
  const inputId = useId();
  const saved = String(service.config.port);
  const [port, setPort] = useState(saved);
  const [errors, setErrors] = useState<FieldErrors>({});
  const { save, isPending } = useSaveService(service.id);

  function submit() {
    const parsed = parsePort(port);
    if (!parsed.ok) return setErrors({ port: parsed.error });
    setErrors({});
    void save({ config: { port: parsed.value } }, { fields: ["port"], onFieldErrors: setErrors });
  }

  return (
    <SettingsCard
      dirty={port.trim() !== saved}
      saving={isPending}
      onSubmit={submit}
      onReset={() => {
        setPort(saved);
        setErrors({});
      }}
    >
      <Field data-invalid={Boolean(errors.port)}>
        <FieldLabel htmlFor={inputId}>Port du conteneur</FieldLabel>
        <Input
          id={inputId}
          inputMode="numeric"
          value={port}
          aria-invalid={Boolean(errors.port)}
          onChange={(event) => {
            setPort(event.target.value);
            setErrors({});
          }}
          className="w-32 font-mono"
        />
        {errors.port ? (
          <FieldError>{errors.port}</FieldError>
        ) : (
          <FieldDescription>
            Port sur lequel votre application écoute. Les domaines publics y sont routés.
          </FieldDescription>
        )}
      </Field>
    </SettingsCard>
  );
}
