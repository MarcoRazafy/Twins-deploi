"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CopyButton } from "@/components/shared/copy-button";
import { CopyField } from "@/components/shared/copy-field";
import { SearchInput } from "@/components/shared/search-input";
import { SecretValue } from "@/components/shared/secret-value";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { REGION_LABELS } from "@/lib/constants";
import { slugify } from "@/lib/format";
import { REGIONS, type Region } from "@/lib/types";

import { KitExample, KitLabel, KitSection } from "./kit-section";

const TAKEN_NAMES = ["cancham connect", "boutique vanille"];

const VARIABLES = [
  { key: "DATABASE_URL", value: "postgresql://postgres:Xk29fLq8vTz@postgres.railway.internal:5432/railway" },
  { key: "SMTP_PASSWORD", value: "mr_live_7f3a9c21d4e84b60a5c2" },
  { key: "NEXT_PUBLIC_SITE_URL", value: "https://cancham.mg" },
];

const SEARCHABLE = [
  "cancham-web",
  "api-gateway",
  "worker-emails",
  "Postgres",
  "redis-cache",
  "metabase",
];

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return "Le nom doit contenir au moins 2 caractères.";
  if (trimmed.length > 40) return "Le nom ne peut pas dépasser 40 caractères.";
  if (TAKEN_NAMES.includes(trimmed.toLowerCase())) return "Un projet porte déjà ce nom.";
  return null;
}

export function FormsSection() {
  const [name, setName] = useState("CanCham Connect");
  const [nameError, setNameError] = useState<string | null>("Un projet porte déjà ce nom.");
  const [region, setRegion] = useState<Region>("eu-west");
  const [publicNetworking, setPublicNetworking] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);

  const results = SEARCHABLE.filter((item) =>
    item.toLowerCase().includes(debouncedSearch.trim().toLowerCase()),
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateName(name);
    setNameError(error);
    if (!error) toast.success("Projet créé", { description: slugify(name) });
  }

  return (
    <KitSection
      id="formulaires"
      title="Formulaires et saisie"
      description="Un libellé toujours visible, l’aide et l’erreur sous le champ, la validation au blur et à la soumission. Les valeurs techniques se copient d’un clic et les secrets restent masqués."
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KitExample title="Recette de champ" code="Field · FieldLabel · FieldError">
          <form onSubmit={handleSubmit} noValidate>
            <FieldGroup>
              <Field data-invalid={nameError ? true : undefined}>
                <FieldLabel htmlFor="kit-project-name">Nom du projet</FieldLabel>
                <Input
                  id="kit-project-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => setNameError(validateName(name))}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby="kit-project-name-help"
                  autoComplete="off"
                />
                {nameError ? (
                  <FieldError id="kit-project-name-help">{nameError}</FieldError>
                ) : (
                  <FieldDescription id="kit-project-name-help">
                    Identifiant : {slugify(name) || "—"}
                  </FieldDescription>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="kit-region">Région</FieldLabel>
                <Select value={region} onValueChange={(value) => setRegion(value as Region)}>
                  <SelectTrigger id="kit-region" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {REGION_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Les services du projet tournent dans cette région.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="kit-description">Description</FieldLabel>
                <Textarea
                  id="kit-description"
                  placeholder="À quoi sert ce projet ?"
                  defaultValue="Site des adhérents et API de la Chambre de commerce."
                />
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="kit-public">Accès public à la base</FieldLabel>
                  <FieldDescription>
                    Expose un proxy TCP. Désactivé, seule l’adresse privée répond.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="kit-public"
                  checked={publicNetworking}
                  onCheckedChange={setPublicNetworking}
                />
              </Field>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setNameError(null)}>
                  Annuler
                </Button>
                <Button type="submit">Créer le projet</Button>
              </div>
            </FieldGroup>
          </form>
        </KitExample>

        <div className="grid grid-cols-1 content-start gap-4">
          <KitExample title="Recherche" code="<SearchInput shortcut />" bodyClassName="space-y-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Filtrer les services…"
              shortcut="/"
              className="sm:w-full"
            />
            <div className="flex min-h-7 flex-wrap gap-1.5">
              {results.length > 0 ? (
                results.map((item) => (
                  <span
                    key={item}
                    className="rounded-md bg-secondary px-2 py-1 font-mono text-xs text-muted-foreground"
                  >
                    {item}
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">Aucun service ne correspond.</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              La touche / place le curseur dans le champ. Échap efface la saisie, puis quitte le champ.
            </p>
          </KitExample>

          <KitExample title="Champs à copier" code="<CopyField />" bodyClassName="space-y-4">
            <CopyField label="Domaine généré" value="cancham-web-production.up.mini-railway.app" />
            <CopyField
              label="URL de connexion interne"
              value="postgresql://postgres:Xk29fLq8vTz@postgres.railway.internal:5432/railway"
              mono
            />
            <CopyField label="Mot de passe" value="Xk29fLq8vTz-4mQp7" mono secret />
          </KitExample>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KitExample title="Secrets en ligne" code="<SecretValue />" bodyClassName="p-0 sm:p-0">
          <ul className="divide-y">
            {VARIABLES.map((variable) => (
              <li
                key={variable.key}
                className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5"
              >
                <span className="shrink-0 font-mono text-[13px]">{variable.key}</span>
                <SecretValue value={variable.value} className="justify-end" />
              </li>
            ))}
          </ul>
        </KitExample>

        <KitExample title="Bouton copier" code="<CopyButton />" bodyClassName="space-y-4">
          <div className="space-y-2">
            <KitLabel>Icône seule, avec infobulle</KitLabel>
            <div className="flex items-center gap-3">
              <code className="rounded-md bg-secondary px-2 py-1 font-mono text-[13px]">a1b2c3d</code>
              <CopyButton value="a1b2c3d4e5f60718" tooltip="Copier le SHA" />
              <CopyButton value="a1b2c3d4e5f60718" variant="outline" size="icon" />
            </div>
          </div>
          <div className="space-y-2">
            <KitLabel>Avec un libellé : la largeur ne change pas</KitLabel>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton
                value="postgresql://postgres:Xk29fLq8vTz@postgres.railway.internal:5432/railway"
                label="Copier l’URL"
              />
              <CopyButton
                value="docker pull nginx:1.27-alpine"
                label="Copier la commande"
                variant="secondary"
              />
            </div>
          </div>
        </KitExample>
      </div>
    </KitSection>
  );
}
