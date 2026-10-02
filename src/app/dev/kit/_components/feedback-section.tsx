"use client";

import { useState } from "react";
import { Globe, Inbox, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/contract";

import { KitExample, KitLabel, KitSection } from "./kit-section";

const PROJECT_NAME = "cancham-connect";
const SAMPLE_ERROR = new ApiError(
  "unavailable",
  "Le démon Docker ne répond pas. Vérifiez que le service est démarré sur l’hôte.",
);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface FeedbackSectionProps {
  loading: boolean;
}

export function FeedbackSection({ loading }: FeedbackSectionProps) {
  const [restartOpen, setRestartOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteProject() {
    setDeleting(true);
    await wait(1400);
    setDeleting(false);
    setDeleteOpen(false);
    toast.success("Projet supprimé", { description: PROJECT_NAME });
  }

  return (
    <KitSection
      id="retours"
      title="Retours"
      description={"Aucune action ne reste sans réponse : état vide avec une action pour démarrer, erreur avec «\u00a0Réessayer\u00a0», toast après une mutation, confirmation avant une suppression."}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EmptyState
          icon={Globe}
          title="Aucun domaine"
          description="Générez un domaine pour exposer ce service, ou branchez un domaine que vous possédez déjà."
          action={
            <Button>
              <Plus data-icon="inline-start" />
              Ajouter un domaine
            </Button>
          }
          secondaryAction={<Button variant="outline">Générer un domaine</Button>}
        />
        <ErrorState
          error={SAMPLE_ERROR}
          onRetry={() => toast("Nouvelle tentative de chargement")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KitExample title="Variantes compactes" code="compact" bodyClassName="grid grid-cols-1 gap-4 p-0 sm:grid-cols-2 sm:p-0">
          <EmptyState
            compact
            icon={Inbox}
            title="Aucune notification"
            description="Les événements de vos projets apparaîtront ici."
          />
          <ErrorState
            compact
            title="Métriques indisponibles"
            onRetry={() => toast("Nouvelle tentative de chargement")}
          />
        </KitExample>

        <KitExample title="Toasts" code="toast() de sonner" bodyClassName="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => toast.success("Projet créé")}>
              Succès
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.error("Le déploiement a échoué", {
                  description: "cancham-web · le build s’est arrêté avec le code 1",
                  action: { label: "Voir les logs", onClick: () => toast("Ouverture des logs") },
                })
              }
            >
              Erreur avec action
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.warning("Vérification DNS en attente", {
                  description: "app.cancham.mg · l’enregistrement CNAME est introuvable",
                })
              }
            >
              Avertissement
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast("Variable supprimée", {
                  description: "SMTP_PASSWORD",
                  action: { label: "Annuler", onClick: () => toast.success("Variable rétablie") },
                })
              }
            >
              Annulable
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast.promise(wait(1600), {
                  loading: "Création de la sauvegarde…",
                  success: "Sauvegarde terminée",
                  error: "La sauvegarde a échoué",
                })
              }
            >
              Opération longue
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Une phrase courte, une description et une action au besoin. Jamais de toast pour une
            simple navigation.
          </p>
        </KitExample>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KitExample title="Confirmation" code="<ConfirmDialog />" bodyClassName="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setRestartOpen(true)}>
              Redémarrer le service
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 data-icon="inline-start" />
              Supprimer le projet
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            La suppression exige de saisir <span className="font-mono">{PROJECT_NAME}</span>, puis
            le dialogue reste ouvert pendant l’opération.
          </p>

          <ConfirmDialog
            open={restartOpen}
            onOpenChange={setRestartOpen}
            title="Redémarrer cancham-web ?"
            description="Le service sera indisponible quelques secondes, le temps que le conteneur redémarre."
            confirmLabel="Redémarrer"
            onConfirm={() => {
              setRestartOpen(false);
              toast.success("Service redémarré");
            }}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            tone="danger"
            title="Supprimer le projet"
            description="Les 4 services, leurs déploiements, variables, domaines et la base de données seront supprimés. Cette action est irréversible."
            confirmLabel="Supprimer le projet"
            confirmText={PROJECT_NAME}
            loading={deleting}
            onConfirm={deleteProject}
          />
        </KitExample>

        <KitExample title="Squelettes" code="<Skeleton />" bodyClassName="space-y-3">
          <KitLabel>Même géométrie que le contenu : aucune saccade à l’arrivée des données</KitLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2.5">
              {loading ? (
                <>
                  <Skeleton className="size-9 rounded-lg bg-accent" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3.5 w-28 bg-accent" />
                    <Skeleton className="h-3 w-40 bg-accent" />
                  </div>
                </>
              ) : (
                <>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-sm font-semibold">
                    CC
                  </span>
                  <div>
                    <p className="text-sm leading-5 font-medium">CanCham Connect</p>
                    <p className="text-xs leading-4 text-muted-foreground">4 services · 1 base</p>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary px-3 py-2.5">
              {loading ? (
                <>
                  <Skeleton className="h-3.5 w-32 bg-accent" />
                  <Skeleton className="h-6 w-20 rounded-full bg-accent" />
                </>
              ) : (
                <>
                  <span className="text-sm leading-5">app.cancham.mg</span>
                  <span className="inline-flex h-6 items-center rounded-full border border-success/25 bg-success/10 px-2.5 text-xs font-medium text-success">
                    Actif
                  </span>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Activez «{"\u00a0"}États de chargement{"\u00a0"}» en haut de page pour basculer tout le kit.
          </p>
        </KitExample>
      </div>
    </KitSection>
  );
}
