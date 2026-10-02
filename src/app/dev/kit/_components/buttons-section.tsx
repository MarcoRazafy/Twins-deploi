"use client";

import { useState } from "react";
import {
  Ellipsis,
  ExternalLink,
  Play,
  Plus,
  RotateCw,
  Rocket,
  Settings,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { KitExample, KitLabel, KitSection } from "./kit-section";

const VARIANTS = [
  { variant: "default", label: "Déployer", usage: "Action principale (une par écran)" },
  { variant: "secondary", label: "Redéployer", usage: "Action secondaire visible" },
  { variant: "outline", label: "Annuler", usage: "Action neutre, barre d’outils" },
  { variant: "ghost", label: "Détails", usage: "Action de ligne, navigation" },
  { variant: "destructive", label: "Supprimer", usage: "Suppression, toujours confirmée" },
  { variant: "link", label: "Voir la documentation", usage: "Lien dans du texte" },
] as const;

const SIZES = ["xs", "sm", "default", "lg"] as const;

export function ButtonsSection() {
  const [deploying, setDeploying] = useState(false);

  function simulateDeploy() {
    setDeploying(true);
    window.setTimeout(() => {
      setDeploying(false);
      toast.success("Déploiement lancé", { description: "cancham-web · main" });
    }, 1400);
  }

  return (
    <KitSection
      id="boutons"
      title="Boutons"
      description="Un seul bouton principal par écran. Les boutons icône portent un aria-label et une infobulle ; pendant une mutation, le spinner remplace l’icône sans changer la largeur."
    >
      <KitExample title="Variantes" code="<Button variant />">
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          {VARIANTS.map((item) => (
            <div key={item.variant} className="flex items-center gap-3">
              <div className="flex w-44 shrink-0 justify-start">
                <Button variant={item.variant}>{item.label}</Button>
              </div>
              <div className="min-w-0">
                <p className="font-mono text-xs">{item.variant}</p>
                <p className="truncate text-xs text-muted-foreground">{item.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </KitExample>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KitExample title="Tailles et icônes" code="size · data-icon" bodyClassName="space-y-4">
          <div className="space-y-2">
            <KitLabel>xs, sm, default, lg</KitLabel>
            <div className="flex flex-wrap items-center gap-2">
              {SIZES.map((size) => (
                <Button key={size} size={size} variant="secondary">
                  <Plus data-icon="inline-start" />
                  Nouveau service
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <KitLabel>Icône avant ou après le libellé</KitLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Button>
                <Rocket data-icon="inline-start" />
                Déployer
              </Button>
              <Button variant="outline">
                Ouvrir le site
                <ExternalLink data-icon="inline-end" />
              </Button>
              <Button variant="secondary" disabled>
                <Square data-icon="inline-start" />
                Arrêter
              </Button>
            </div>
          </div>
        </KitExample>

        <KitExample title="États et boutons icône" code="disabled · Spinner · Tooltip" bodyClassName="space-y-4">
          <div className="space-y-2">
            <KitLabel>Mutation en cours</KitLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={simulateDeploy} disabled={deploying}>
                {deploying ? (
                  <Spinner data-icon="inline-start" aria-label="Chargement" />
                ) : (
                  <Rocket data-icon="inline-start" />
                )}
                Déployer
              </Button>
              <Button variant="secondary" disabled>
                <Spinner data-icon="inline-start" aria-label="Chargement" />
                Redémarrage
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <KitLabel>Boutons icône et menu d’actions</KitLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Démarrer">
                    <Play />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Démarrer</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Redémarrer">
                    <RotateCw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Redémarrer</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label="Réglages">
                    <Settings />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Réglages</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Actions du service">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>cancham-web</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => toast.success("Redéploiement lancé")}>
                    <Rocket />
                    Redéployer
                    <DropdownMenuShortcut>R</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => toast("Service redémarré")}>
                    <RotateCw />
                    Redémarrer
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    <Trash2 />
                    Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </KitExample>
      </div>
    </KitSection>
  );
}
