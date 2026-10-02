import type {
  ActivityEvent,
  ActivitySeverity,
  ActivityType,
  Deployment,
  Service,
} from "@/lib/types";

import { SYSTEM_ACTOR } from "../domain/activity";
import { HOUR, iso } from "../text";
import { OWNER_NAME, PRJ, SVC, type SeedClock } from "./clock";
import { IN_FLIGHT_DEPLOYMENT_ID } from "./deployments";

interface Draft {
  at: number;
  type: ActivityType;
  severity: ActivitySeverity;
  title: string;
  description: string;
  projectId?: string;
  serviceId?: string;
  deploymentId?: string;
  actor?: string;
  unread?: boolean;
}

/** Deployments older than this only live in the deployment history. */
const DEPLOYMENT_WINDOW_HOURS = 150;

function deploymentEvents(clock: SeedClock, deployments: Deployment[], services: Service[]): Draft[] {
  const drafts: Draft[] = [];
  for (const deployment of deployments) {
    const service = services.find((item) => item.id === deployment.serviceId);
    if (!service || !deployment.finishedAt) continue;
    const finishedAt = Date.parse(deployment.finishedAt);
    if (clock.now - finishedAt > DEPLOYMENT_WINDOW_HOURS * HOUR) continue;

    const subject = `${service.name} · ${deployment.commit?.message ?? deployment.image ?? ""}`;
    const links = {
      projectId: deployment.projectId,
      serviceId: deployment.serviceId,
      deploymentId: deployment.id,
      actor: deployment.creator,
    };

    if (deployment.trigger === "rollback") {
      drafts.push({
        ...links,
        at: Date.parse(deployment.createdAt),
        type: "deployment.rolled_back",
        severity: "warning",
        title: "Restauration d’une version",
        description: subject,
      });
    }
    if (deployment.status === "failed") {
      drafts.push({
        ...links,
        at: finishedAt,
        type: "deployment.failed",
        severity: "error",
        title: "Échec du déploiement",
        description: `${service.name} · ${deployment.error ?? ""}`,
      });
    } else if (deployment.status === "cancelled") {
      drafts.push({
        ...links,
        at: finishedAt,
        type: "deployment.cancelled",
        severity: "warning",
        title: "Déploiement annulé",
        description: subject,
      });
    } else {
      drafts.push({
        ...links,
        at: finishedAt,
        type: "deployment.succeeded",
        severity: "success",
        title: "Déploiement réussi",
        description: subject,
        // The two latest releases have not been looked at yet.
        unread: clock.now - finishedAt < 18 * HOUR && deployment.status === "active",
      });
    }
  }
  return drafts;
}

function platformEvents(clock: SeedClock): Draft[] {
  const hoursAgo = (hours: number) => clock.now - hours * HOUR;
  return [
    {
      at: clock.now - 4000,
      type: "service.created",
      severity: "info",
      title: "Service créé",
      description: "n8n · image n8nio/n8n:1.64.0",
      projectId: PRJ.observatoire,
      serviceId: SVC.observatoireN8n,
    },
    {
      at: clock.now - 3200,
      type: "deployment.started",
      severity: "info",
      title: "Déploiement lancé",
      description: "n8n · n8nio/n8n:1.64.0",
      projectId: PRJ.observatoire,
      serviceId: SVC.observatoireN8n,
      deploymentId: IN_FLIGHT_DEPLOYMENT_ID,
    },
    {
      at: hoursAgo(2.9),
      type: "service.crashed",
      severity: "error",
      title: "Service en erreur",
      description: "worker · le processus s’est arrêté avec le code 1 après 5 redémarrages",
      projectId: PRJ.boutique,
      serviceId: SVC.boutiqueWorker,
      deploymentId: "dep_boutique_worker_05",
      actor: SYSTEM_ACTOR,
      unread: true,
    },
    {
      at: hoursAgo(4.98),
      type: "backup.completed",
      severity: "success",
      title: "Sauvegarde terminée",
      description: "Postgres · Sauvegarde quotidienne (884 Mo)",
      projectId: PRJ.observatoire,
      serviceId: SVC.observatoirePostgres,
      actor: SYSTEM_ACTOR,
      unread: true,
    },
    {
      at: hoursAgo(5.98),
      type: "backup.completed",
      severity: "success",
      title: "Sauvegarde terminée",
      description: "Postgres · Sauvegarde quotidienne (388 Mo)",
      projectId: PRJ.boutique,
      serviceId: SVC.boutiquePostgres,
      actor: SYSTEM_ACTOR,
    },
    {
      at: hoursAgo(6.98),
      type: "backup.completed",
      severity: "success",
      title: "Sauvegarde terminée",
      description: "Postgres · Sauvegarde quotidienne (132 Mo)",
      projectId: PRJ.cancham,
      serviceId: SVC.canchamPostgres,
      actor: SYSTEM_ACTOR,
    },
    {
      at: hoursAgo(38),
      type: "variable.updated",
      severity: "info",
      title: "Variable modifiée",
      description: "MVOLA_CONSUMER_KEY · api",
      projectId: PRJ.boutique,
      serviceId: SVC.boutiqueApi,
    },
    {
      at: hoursAgo(48),
      type: "settings.updated",
      severity: "info",
      title: "Membre invité",
      description: "tiana.rasoanaivo@gmail.com · Lecteur",
    },
    {
      at: hoursAgo(144),
      type: "service.stopped",
      severity: "warning",
      title: "Service arrêté",
      description: "site",
      projectId: PRJ.portfolio,
      serviceId: SVC.portfolioSite,
    },
    {
      at: hoursAgo(156),
      type: "domain.added",
      severity: "info",
      title: "Domaine ajouté",
      description: "marco-razafy.dev · site",
      projectId: PRJ.portfolio,
      serviceId: SVC.portfolioSite,
    },
    {
      at: hoursAgo(213.6),
      type: "variable.updated",
      severity: "info",
      title: "Variable modifiée",
      description: "SMTP_HOST · cancham-app",
      projectId: PRJ.cancham,
      serviceId: SVC.canchamApp,
    },
    {
      at: hoursAgo(215.98),
      type: "backup.completed",
      severity: "success",
      title: "Sauvegarde terminée",
      description: "Postgres · Avant les promotions de la récolte (371 Mo)",
      projectId: PRJ.boutique,
      serviceId: SVC.boutiquePostgres,
    },
    {
      at: hoursAgo(288),
      type: "settings.updated",
      severity: "info",
      title: "Jeton d’API créé",
      description: "CLI portable",
    },
    {
      at: hoursAgo(384),
      type: "domain.verified",
      severity: "success",
      title: "Domaine vérifié",
      description: "app.cancham.mg · certificat SSL émis",
      projectId: PRJ.cancham,
      serviceId: SVC.canchamApp,
      actor: SYSTEM_ACTOR,
    },
    {
      at: hoursAgo(408),
      type: "domain.added",
      severity: "info",
      title: "Domaine ajouté",
      description: "app.cancham.mg · cancham-app",
      projectId: PRJ.cancham,
      serviceId: SVC.canchamApp,
    },
    {
      at: hoursAgo(430.1),
      type: "service.created",
      severity: "info",
      title: "Service créé",
      description: "cancham-app · dépôt MarcoRazafy/cancham-app",
      projectId: PRJ.cancham,
      serviceId: SVC.canchamApp,
    },
    {
      at: hoursAgo(431.6),
      type: "database.created",
      severity: "info",
      title: "Base de données créée",
      description: "Postgres · PostgreSQL 17",
      projectId: PRJ.cancham,
      serviceId: SVC.canchamPostgres,
    },
    {
      at: hoursAgo(432),
      type: "project.created",
      severity: "info",
      title: "Projet créé",
      description: "CanCham",
      projectId: PRJ.cancham,
    },
    {
      at: hoursAgo(1128),
      type: "project.created",
      severity: "info",
      title: "Projet créé",
      description: "Boutique Vanille",
      projectId: PRJ.boutique,
    },
    {
      at: hoursAgo(1728),
      type: "project.created",
      severity: "info",
      title: "Projet créé",
      description: "Observatoire",
      projectId: PRJ.observatoire,
    },
    {
      at: hoursAgo(2880),
      type: "github.connected",
      severity: "success",
      title: "GitHub connecté",
      description: "Compte MarcoRazafy · organisation cancham-mg",
    },
    {
      at: hoursAgo(3120),
      type: "project.created",
      severity: "info",
      title: "Projet créé",
      description: "Portfolio",
      projectId: PRJ.portfolio,
    },
  ];
}

export function seedActivity(
  clock: SeedClock,
  deployments: Deployment[],
  services: Service[],
): ActivityEvent[] {
  return [...deploymentEvents(clock, deployments, services), ...platformEvents(clock)]
    .sort((a, b) => b.at - a.at)
    .map((draft, index) => ({
      id: `act_${String(index + 1).padStart(3, "0")}`,
      type: draft.type,
      severity: draft.severity,
      title: draft.title,
      description: draft.description,
      projectId: draft.projectId ?? null,
      serviceId: draft.serviceId ?? null,
      deploymentId: draft.deploymentId ?? null,
      actor: draft.actor ?? OWNER_NAME,
      read: !draft.unread,
      createdAt: iso(draft.at),
    }));
}
