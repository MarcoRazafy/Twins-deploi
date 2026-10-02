"use client";

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RestartPolicy, Service } from "@/lib/types";

import { useSaveService, type FieldErrors } from "../../hooks/use-save-service";
import { CONFIG_LIMITS, validateHealthcheckPath } from "../../lib/config-rules";
import { SettingsCard } from "./settings-card";

const RESTART_LABELS: Record<RestartPolicy, string> = {
  always: "Toujours",
  "on-failure": "En cas d’échec",
  never: "Jamais",
};

const FIELDS = ["startCommand", "healthcheckPath", "restartPolicy", "replicas"] as const;

/** Start command, healthcheck, restart policy and replicas. */
export function DeployCard({ service }: { service: Service }) {
  const ids = { start: useId(), health: useId(), restart: useId(), replicas: useId() };
  const { config } = service;
  const [startCommand, setStartCommand] = useState(config.startCommand);
  const [healthcheckPath, setHealthcheckPath] = useState(config.healthcheckPath);
  const [restartPolicy, setRestartPolicy] = useState(config.restartPolicy);
  const [replicas, setReplicas] = useState(config.replicas);
  const [errors, setErrors] = useState<FieldErrors>({});
  const { save, isPending } = useSaveService(service.id);

  const dirty =
    startCommand.trim() !== config.startCommand ||
    healthcheckPath.trim() !== config.healthcheckPath ||
    restartPolicy !== config.restartPolicy ||
    replicas !== config.replicas;

  function clear(field: string) {
    setErrors((current) => (field in current ? {} : current));
  }

  function submit() {
    const healthError = validateHealthcheckPath(healthcheckPath);
    if (healthError) return setErrors({ healthcheckPath: healthError });
    setErrors({});
    void save(
      {
        config: {
          startCommand: startCommand.trim(),
          healthcheckPath: healthcheckPath.trim(),
          restartPolicy,
          replicas,
        },
      },
      { fields: FIELDS, onFieldErrors: setErrors },
    );
  }

  return (
    <SettingsCard
      dirty={dirty}
      saving={isPending}
      onSubmit={submit}
      onReset={() => {
        setStartCommand(config.startCommand);
        setHealthcheckPath(config.healthcheckPath);
        setRestartPolicy(config.restartPolicy);
        setReplicas(config.replicas);
        setErrors({});
      }}
    >
      <Field data-invalid={Boolean(errors.startCommand)}>
        <FieldLabel htmlFor={ids.start}>Commande de démarrage</FieldLabel>
        <Input
          id={ids.start}
          value={startCommand}
          placeholder="Détectée automatiquement"
          aria-invalid={Boolean(errors.startCommand)}
          onChange={(event) => {
            setStartCommand(event.target.value);
            clear("startCommand");
          }}
          className="font-mono text-[13px]"
        />
        {errors.startCommand ? (
          <FieldError>{errors.startCommand}</FieldError>
        ) : (
          <FieldDescription>Laisser vide pour utiliser la commande par défaut.</FieldDescription>
        )}
      </Field>

      <Field data-invalid={Boolean(errors.healthcheckPath)}>
        <FieldLabel htmlFor={ids.health}>Chemin du healthcheck</FieldLabel>
        <Input
          id={ids.health}
          value={healthcheckPath}
          placeholder="/health"
          aria-invalid={Boolean(errors.healthcheckPath)}
          onChange={(event) => {
            setHealthcheckPath(event.target.value);
            clear("healthcheckPath");
          }}
          className="font-mono text-[13px]"
        />
        {errors.healthcheckPath ? (
          <FieldError>{errors.healthcheckPath}</FieldError>
        ) : (
          <FieldDescription>
            Le déploiement n’est validé que si ce chemin répond. Laisser vide pour désactiver.
          </FieldDescription>
        )}
      </Field>

      <div className="grid gap-5 @md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={ids.restart}>Politique de redémarrage</FieldLabel>
          <Select
            value={restartPolicy}
            onValueChange={(value) => setRestartPolicy(value as RestartPolicy)}
          >
            <SelectTrigger id={ids.restart} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RESTART_LABELS) as RestartPolicy[]).map((policy) => (
                <SelectItem key={policy} value={policy}>
                  {RESTART_LABELS[policy]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field data-invalid={Boolean(errors.replicas)}>
          <FieldLabel htmlFor={ids.replicas}>Réplicas</FieldLabel>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Retirer un réplica"
              disabled={replicas <= CONFIG_LIMITS.replicas.min}
              onClick={() => setReplicas((value) => Math.max(CONFIG_LIMITS.replicas.min, value - 1))}
            >
              <Minus />
            </Button>
            <output
              id={ids.replicas}
              aria-live="polite"
              className="tabular w-8 text-center text-sm font-medium"
            >
              {replicas}
            </output>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Ajouter un réplica"
              disabled={replicas >= CONFIG_LIMITS.replicas.max}
              onClick={() => setReplicas((value) => Math.min(CONFIG_LIMITS.replicas.max, value + 1))}
            >
              <Plus />
            </Button>
          </div>
          {errors.replicas ? (
            <FieldError>{errors.replicas}</FieldError>
          ) : (
            <FieldDescription>De 1 à 5 instances.</FieldDescription>
          )}
        </Field>
      </div>
    </SettingsCard>
  );
}
