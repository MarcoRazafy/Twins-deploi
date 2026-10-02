"use client";

import { useId, useState } from "react";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Builder, Service } from "@/lib/types";

import { useSaveService } from "../../hooks/use-save-service";
import { Segmented } from "../segmented";
import { SettingsCard } from "./settings-card";

const BUILDER_OPTIONS = [
  { value: "nixpacks", label: "Nixpacks" },
  { value: "dockerfile", label: "Dockerfile" },
] as const satisfies ReadonlyArray<{ value: Builder; label: string }>;

/** Builder and build command of a GitHub service. */
export function BuildCard({ service }: { service: Service }) {
  const commandId = useId();
  const { builder: savedBuilder, buildCommand: savedCommand } = service.config;
  const [builder, setBuilder] = useState<Builder>(savedBuilder);
  const [command, setCommand] = useState(savedCommand);
  const { save, isPending } = useSaveService(service.id);

  return (
    <SettingsCard
      dirty={builder !== savedBuilder || command.trim() !== savedCommand}
      saving={isPending}
      onSubmit={() =>
        void save(
          { config: { builder, buildCommand: command.trim() } },
          { fields: [], onFieldErrors: () => undefined },
        )
      }
      onReset={() => {
        setBuilder(savedBuilder);
        setCommand(savedCommand);
      }}
    >
      <Field>
        <FieldLabel>Mode de build</FieldLabel>
        <Segmented
          label="Mode de build"
          value={builder}
          onValueChange={setBuilder}
          options={BUILDER_OPTIONS}
          className="w-full @sm:w-64"
        />
        <FieldDescription>
          {builder === "nixpacks"
            ? "Le langage et le framework sont détectés automatiquement."
            : "L’image est construite à partir du Dockerfile du dépôt."}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={commandId}>Commande de build</FieldLabel>
        <Input
          id={commandId}
          value={command}
          placeholder="Détectée automatiquement"
          onChange={(event) => setCommand(event.target.value)}
          className="font-mono text-[13px]"
        />
        <FieldDescription>Laisser vide pour utiliser la commande détectée.</FieldDescription>
      </Field>
    </SettingsCard>
  );
}
