import type { Api, EntityName } from "@/lib/api/contract";
import type { Deployment, DeploymentCommit, DeploymentTrigger, Service } from "@/lib/types";

import { addActivity } from "../domain/activity";
import { deploymentLogLines } from "../domain/deployment-logs";
import { headCommit, pushCommit, startDeployment } from "../domain/deployments";
import { statusEntities } from "../domain/services";
import { emit } from "../emitter";
import { conflict } from "../errors";
import { newSha } from "../ids";
import { requireDeployment, requireService } from "../lookup";
import { isInFlight, type MockDb } from "../schema";
import {
  abortDeployment,
  restoreServiceAfterAbort,
  subscribeDeploymentLogs,
} from "../simulator/deployments";
import { newestFirst } from "../text";
import { read, write } from "./respond";

function ids(deployment: Deployment) {
  return {
    projectId: deployment.projectId,
    serviceId: deployment.serviceId,
    deploymentId: deployment.id,
  };
}

/** Collections affected when a deployment starts or ends. */
function lifecycleEntities(service: Service): EntityName[] {
  return ["deployments", "activity", ...statusEntities(service)];
}

/** Which commit a new deployment of a GitHub service builds. */
function resolveCommit(
  db: MockDb,
  service: Service,
  trigger: DeploymentTrigger,
): { commit: DeploymentCommit | null; creator?: string; pushed: boolean } {
  const source = service.source;
  if (source.type !== "github") return { commit: null, pushed: false };

  if (trigger === "push") {
    const commit = pushCommit(db, source);
    return { commit, creator: commit.author, pushed: true };
  }

  const current =
    db.deployments.find((item) => item.id === service.activeDeploymentId)?.commit ??
    db.deployments.find((item) => item.id === service.latestDeploymentId)?.commit ??
    null;
  // "manual" deploys the tip of the branch; "redeploy" and "config" rebuild
  // the commit that is already live.
  const head = db.github.connection.connected ? headCommit(db, source) : null;
  const commit = trigger === "manual" ? (head ?? current) : (current ?? head);
  return {
    commit: commit ?? {
      sha: newSha(),
      message: "Déploiement manuel",
      author: db.profile.name,
      branch: source.branch,
    },
    pushed: false,
  };
}

export const deploymentsApi: Api["deployments"] = {
  list: (filter = {}) =>
    read((db) => {
      const statuses = filter.statuses && filter.statuses.length > 0 ? filter.statuses : null;
      const items = newestFirst(db.deployments).filter(
        (item) =>
          (filter.projectId === undefined || item.projectId === filter.projectId) &&
          (filter.serviceId === undefined || item.serviceId === filter.serviceId) &&
          (statuses === null || statuses.includes(item.status)),
      );
      return filter.limit !== undefined && filter.limit >= 0 ? items.slice(0, filter.limit) : items;
    }),

  get: (id) => read((db) => requireDeployment(db, id)),

  trigger: (serviceId, options) =>
    write((db) => {
      const service = requireService(db, serviceId);
      const trigger = options?.trigger ?? "manual";
      const { commit, creator, pushed } = resolveCommit(db, service, trigger);
      const deployment = startDeployment(db, service, { trigger, commit, creator });
      const entities = lifecycleEntities(service);
      if (pushed) entities.push("github");
      emit(entities, ids(deployment));
      return deployment;
    }),

  rollback: (deploymentId) =>
    write((db) => {
      const target = requireDeployment(db, deploymentId);
      if (target.status !== "removed") {
        throw conflict("Seule une ancienne version déployée avec succès peut être restaurée.");
      }
      const service = requireService(db, target.serviceId);
      const deployment = startDeployment(db, service, {
        trigger: "rollback",
        commit: target.commit,
        image: target.image,
      });
      emit(lifecycleEntities(service), ids(deployment));
      return deployment;
    }),

  cancel: (deploymentId) =>
    write((db) => {
      const deployment = requireDeployment(db, deploymentId);
      if (!isInFlight(deployment)) throw conflict("Ce déploiement n’est plus en cours.");
      const service = requireService(db, deployment.serviceId);

      abortDeployment(db, deployment, "user");
      restoreServiceAfterAbort(db, service);
      addActivity(db, {
        type: "deployment.cancelled",
        severity: "warning",
        title: "Déploiement annulé",
        description: `${service.name} · ${deployment.commit?.message ?? deployment.image ?? ""}`,
        ...ids(deployment),
      });
      emit(lifecycleEntities(service), ids(deployment));
      return deployment;
    }),

  getLogs: (deploymentId) =>
    read((db) => deploymentLogLines(db, requireDeployment(db, deploymentId))),

  subscribeLogs: (deploymentId, onLines) => subscribeDeploymentLogs(deploymentId, onLines),
};
