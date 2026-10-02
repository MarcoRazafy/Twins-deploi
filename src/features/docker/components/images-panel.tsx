"use client";

import { useState } from "react";
import { Eraser, ImageOff, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DockerIcon } from "@/components/icons/brand-icons";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { RelativeTime } from "@/components/shared/relative-time";
import { SearchInput } from "@/components/shared/search-input";
import { TableShell } from "@/components/shared/table-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { formatMegabytes, pluralize } from "@/lib/format";
import { useDockerImages, usePruneDockerImages, useRemoveDockerImage } from "@/lib/queries";
import type { DockerImage } from "@/lib/types";

function ImagesHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>Image</TableHead>
        <TableHead>Taille</TableHead>
        <TableHead className="hidden sm:table-cell">Créée</TableHead>
        <TableHead>Utilisation</TableHead>
        <TableHead className="text-right">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function ImageRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-4 w-44" />
        <Skeleton className="mt-1.5 h-3 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-16" />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-28 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="ml-auto size-7" />
      </TableCell>
    </TableRow>
  );
}

/** "Images" tab: local images, removal and pruning of the unused ones. */
export function ImagesPanel() {
  const images = useDockerImages();
  const removeImage = useRemoveDockerImage();
  const pruneImages = usePruneDockerImages();

  const [search, setSearch] = useState("");
  const [removal, setRemoval] = useState<{ open: boolean; image: DockerImage | null }>({
    open: false,
    image: null,
  });
  const [pruneOpen, setPruneOpen] = useState(false);

  const all = images.data ?? [];
  const unused = all.filter((image) => image.containers === 0);
  const unusedSize = unused.reduce((sum, image) => sum + image.sizeMb, 0);
  const needle = search.trim().toLowerCase();
  const rows = all.filter(
    (image) =>
      needle === "" ||
      `${image.repository}:${image.tag}`.toLowerCase().includes(needle) ||
      image.id.toLowerCase().includes(needle),
  );

  async function confirmRemoval() {
    const target = removal.image;
    if (!target) return;
    try {
      await removeImage.mutateAsync(target.id);
      toast.success(`Image ${target.repository}:${target.tag} supprimée`);
    } catch (error) {
      if (isApiError(error) && error.code === "conflict") {
        toast.error("Image utilisée par un conteneur", {
          description:
            "Arrêtez ou supprimez d’abord le service qui l’utilise, puis réessayez.",
        });
      } else {
        toast.error(getErrorMessage(error));
      }
    } finally {
      setRemoval((current) => ({ ...current, open: false }));
    }
  }

  async function confirmPrune() {
    try {
      const result = await pruneImages.mutateAsync();
      toast.success(
        `${pluralize(result.removed, "image supprimée", "images supprimées")} · ${formatMegabytes(result.reclaimedMb)} libérés`,
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPruneOpen(false);
    }
  }

  const pruneButton = (
    <Button
      type="button"
      variant="outline"
      disabled={unused.length === 0}
      onClick={() => setPruneOpen(true)}
    >
      <Eraser data-icon="inline-start" />
      Nettoyer les images inutilisées
    </Button>
  );

  const toolbar = (
    <>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Rechercher une image…"
        label="Rechercher une image"
        className="w-full sm:w-72"
      />
      <div className="sm:ml-auto">
        {unused.length === 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex rounded-lg">
                {pruneButton}
              </span>
            </TooltipTrigger>
            <TooltipContent>Aucune image inutilisée à nettoyer</TooltipContent>
          </Tooltip>
        ) : (
          pruneButton
        )}
      </div>
    </>
  );

  let body;
  if (images.isPending) {
    body = (
      <TableShell toolbar={toolbar}>
        <Table aria-busy>
          <ImagesHead />
          <TableBody>
            {Array.from({ length: 5 }, (_, index) => (
              <ImageRowSkeleton key={index} />
            ))}
          </TableBody>
        </Table>
      </TableShell>
    );
  } else if (images.isError) {
    body = (
      <ErrorState
        title="Impossible de charger les images"
        error={images.error}
        onRetry={() => {
          void images.refetch();
        }}
      />
    );
  } else if (all.length === 0) {
    body = (
      <EmptyState
        icon={ImageOff}
        title="Aucune image"
        description="Les images téléchargées lors des déploiements apparaîtront ici."
      />
    );
  } else {
    body = (
      <TableShell
        toolbar={toolbar}
        footer={
          <span>
            {pluralize(unused.length, "image inutilisée", "images inutilisées")} ·{" "}
            {formatMegabytes(unusedSize)} récupérables
          </span>
        }
      >
        <Table>
          <ImagesHead />
          <TableBody>
            {rows.map((image) => (
              <TableRow key={image.id}>
                <TableCell className="max-w-72">
                  <div className="flex items-center gap-2.5">
                    <DockerIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div
                        className="truncate font-mono text-[13px]"
                        title={`${image.repository}:${image.tag}`}
                      >
                        {image.repository}
                        <span className="text-muted-foreground">:{image.tag}</span>
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {image.id.slice(0, 12)}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="tabular whitespace-nowrap">
                  {formatMegabytes(image.sizeMb)}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                  <RelativeTime date={image.createdAt} />
                </TableCell>
                <TableCell>
                  {image.containers > 0 ? (
                    <Badge variant="outline" className="border-success/25 bg-success/10 text-success">
                      Utilisée par {pluralize(image.containers, "conteneur")}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Inutilisée</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Supprimer ${image.repository}:${image.tag}`}
                        onClick={() => setRemoval({ open: true, image })}
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Supprimer l’image</TooltipContent>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <EmptyState
            compact
            icon={ImageOff}
            title="Aucun résultat"
            description="Aucune image ne correspond à cette recherche."
          />
        ) : null}
      </TableShell>
    );
  }

  return (
    <>
      {body}
      <ConfirmDialog
        open={removal.open}
        onOpenChange={(open) => setRemoval((current) => ({ ...current, open }))}
        tone="danger"
        title="Supprimer l’image"
        description={
          removal.image
            ? `${removal.image.repository}:${removal.image.tag} sera supprimée du serveur. Elle sera téléchargée à nouveau au prochain déploiement.`
            : ""
        }
        onConfirm={confirmRemoval}
      />
      <ConfirmDialog
        open={pruneOpen}
        onOpenChange={setPruneOpen}
        tone="danger"
        title="Nettoyer les images inutilisées"
        description={`${pluralize(unused.length, "image inutilisée", "images inutilisées")} (${formatMegabytes(unusedSize)}) seront supprimées définitivement. Les images utilisées par un conteneur sont conservées.`}
        confirmLabel="Nettoyer"
        onConfirm={confirmPrune}
      />
    </>
  );
}
