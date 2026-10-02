"use client";

import { useId, useState, type FormEvent } from "react";
import { ArrowRight, BadgeCheck, Download, PackageSearch, Star } from "lucide-react";
import { motion } from "motion/react";

import { DockerIcon } from "@/components/icons/brand-icons";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { SearchInput } from "@/components/shared/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatNumber } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import { useDockerHubSearch } from "@/lib/queries";
import type { DockerHubImage } from "@/lib/types";
import { cn } from "@/lib/utils";

import { HUB_CATEGORIES, type HubCategoryFilter } from "../lib/container-stats";
import {
  DEFAULT_CUSTOM_PORT,
  parseImageReference,
  validateImage,
  validateTag,
  type ImageSelection,
} from "../lib/image-reference";

function CatalogueCard({ item, onSelect }: { item: DockerHubImage; onSelect: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 text-left transition-colors outline-none hover:border-border-strong hover:bg-secondary/40 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-center gap-2">
        <span className="truncate font-mono text-[13px] font-medium">{item.name}</span>
        {item.official ? (
          <Badge variant="outline" className="border-brand-800 bg-brand-600/10 text-brand-400">
            <BadgeCheck data-icon="inline-start" />
            Officielle
          </Badge>
        ) : null}
      </div>
      <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{item.description}</p>
      <div className="tabular flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Download aria-hidden className="size-3" />
          {item.pulls}
        </span>
        <span className="flex items-center gap-1">
          <Star aria-hidden className="size-3" />
          {formatNumber(item.stars)}
        </span>
      </div>
    </motion.button>
  );
}

function CatalogueSkeleton() {
  return (
    <div aria-busy className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="space-y-2 rounded-xl border bg-card p-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export interface ImagePickerStepProps {
  onSelect: (selection: ImageSelection) => void;
}

/** Step 1: browse the catalogue or type any image reference. */
export function ImagePickerStep({ onSelect }: ImagePickerStepProps) {
  const customId = useId();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 250);
  const [category, setCategory] = useState<HubCategoryFilter>("all");
  const [custom, setCustom] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  const hub = useDockerHubSearch(debounced.trim());
  const items = (hub.data ?? []).filter((item) => category === "all" || item.category === category);

  function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseImageReference(custom);
    const imageError = validateImage(parsed.image);
    const tagError = parsed.tag === null ? null : validateTag(parsed.tag);
    if (imageError || tagError) {
      setCustomError(imageError ?? tagError);
      return;
    }
    const known = hub.data?.find((item) => item.name === parsed.image) ?? null;
    onSelect({
      image: parsed.image,
      tag: parsed.tag ?? known?.defaultTag ?? "latest",
      port: known?.defaultPort ?? DEFAULT_CUSTOM_PORT,
      hub: known,
    });
  }

  let catalogue;
  if (hub.isPending) {
    catalogue = <CatalogueSkeleton />;
  } else if (hub.isError && !hub.data) {
    catalogue = (
      <ErrorState
        compact
        title="Impossible de charger le catalogue"
        error={hub.error}
        onRetry={() => {
          void hub.refetch();
        }}
      />
    );
  } else if (items.length === 0) {
    catalogue = (
      <EmptyState
        compact
        icon={PackageSearch}
        title="Aucune image trouvée"
        description="Essayez un autre terme ou une autre catégorie, ou saisissez une image personnalisée ci-dessous."
      />
    );
  } else {
    catalogue = (
      <div
        className={cn(
          "grid grid-cols-1 gap-2 transition-opacity sm:grid-cols-2",
          hub.isPlaceholderData && "opacity-60",
        )}
      >
        {items.map((item) => (
          <CatalogueCard
            key={item.name}
            item={item}
            onSelect={() =>
              onSelect({
                image: item.name,
                tag: item.defaultTag,
                port: item.defaultPort,
                hub: item,
              })
            }
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SearchInput
        value={query}
        onChange={setQuery}
        autoFocus
        placeholder="Rechercher sur Docker Hub (nginx, redis, grafana…)"
        label="Rechercher une image"
        className="w-full sm:w-full"
      />
      <div
        role="group"
        aria-label="Catégories"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {HUB_CATEGORIES.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={category === item.value}
            onClick={() => setCategory(item.value)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              category === item.value
                ? "border-brand-800 bg-brand-600/15 text-brand-400"
                : "text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="max-h-[44dvh] min-h-48 overflow-y-auto pr-1">{catalogue}</div>

      <form onSubmit={submitCustom} noValidate className="rounded-xl border bg-secondary/40 p-3">
        <Field data-invalid={customError ? true : undefined}>
          <FieldLabel htmlFor={customId}>
            <DockerIcon aria-hidden className="size-3.5" />
            Image personnalisée
          </FieldLabel>
          <div className="flex gap-2">
            <Input
              id={customId}
              value={custom}
              onChange={(event) => {
                setCustom(event.target.value);
                setCustomError(null);
              }}
              placeholder="ghcr.io/acme/api:1.4"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={customError ? true : undefined}
              className="min-w-0 flex-1 font-mono text-[13px]"
            />
            <Button type="submit" variant="secondary" disabled={custom.trim() === ""}>
              Continuer
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
          <FieldDescription>
            Toute référence de registre : image, avec ou sans tag (latest par défaut).
          </FieldDescription>
          <FieldError>{customError}</FieldError>
        </Field>
      </form>
    </div>
  );
}
