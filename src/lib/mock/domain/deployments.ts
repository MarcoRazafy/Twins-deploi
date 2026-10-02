import type {
  Deployment,
  DeploymentCommit,
  DeploymentTrigger,
  GithubSource,
  Service,
} from "@/lib/types";

import { newId, newSha, randomInt } from "../ids";
import { isInFlight, type MockDb } from "../schema";
import { abortDeployment, runDeployment } from "../simulator/deployments";
import { iso, slugify } from "../text";
import { cancelTimer, timerKey } from "../timers";
import { addActivity } from "./activity";
import { registryHost } from "./images";
import { containerOf, setServiceStatus } from "./services";

/** Reference of the image a deployment of this service produces or pulls. */
export function imageReferenceFor(
  db: MockDb,
  service: Service,
  commit: DeploymentCommit | null,
): string {
  const source = service.source;
  if (source.type === "docker") return `${source.image}:${source.tag}`;
  if (source.type === "postgres") return `postgres:${source.version}`;
  const project = db.projects.find((item) => item.id === service.projectId);
  const registry = registryHost(db.settings.docker.registryUrl);
  const tag = commit ? commit.sha.slice(0, 7) : "latest";
  return `${registry}/${project?.slug ?? "projet"}/${slugify(service.name)}:${tag}`;
}

/** HEAD of the branch a GitHub service tracks, when the repository is known. */
export function headCommit(db: MockDb, source: GithubSource): DeploymentCommit | null {
  const branch = db.github.branches[source.repo]?.find((item) => item.name === source.branch);
  if (!branch) return null;
  return {
    sha: branch.lastCommit.sha,
    message: branch.lastCommit.message,
    author: branch.lastCommit.author,
    branch: branch.name,
  };
}

const PUSH_MESSAGES = [
  "fix: corrige un cas limite du formulaire de contact",
  "feat: ajoute l’export CSV des résultats",
  "chore(deps): met à jour les dépendances",
  "refactor: simplifie la gestion des erreurs",
  "perf: met en cache les requêtes fréquentes",
  "fix(ui): alignement des boutons sur mobile",
  "feat(api): pagination des résultats",
  "docs: complète le guide de déploiement",
];

/** Simulates a push: a new commit lands on the tracked branch. */
export function pushCommit(db: MockDb, source: GithubSource): DeploymentCommit {
  const now = iso();
  const commit: DeploymentCommit = {
    sha: newSha(),
    message: PUSH_MESSAGES[randomInt(0, PUSH_MESSAGES.length - 1)],
    author: db.profile.name,
    branch: source.branch,
  };
  const branch = db.github.branches[source.repo]?.find((item) => item.name === source.branch);
  if (branch) {
    branch.lastCommit = { sha: commit.sha, message: commit.message, author: commit.author, date: now };
  }
  const repo = db.github.repos.find((item) => item.fullName === source.repo);
  if (repo) repo.pushedAt = now;
  return commit;
}

/**
 * Queues a deployment and starts its simulation. An in-flight deployment of
 * the same service is cancelled first: the newest one always wins.
 */
export function startDeployment(
  db: MockDb,
  service: Service,
  options: {
    trigger: DeploymentTrigger;
    commit: DeploymentCommit | null;
    /** Defaults to the image of the service source. */
    image?: string | null;
    /** Defaults to the signed-in user. */
    creator?: string;
  },
): Deployment {
  for (const other of db.deployments) {
    if (other.serviceId === service.id && isInFlight(other)) {
      abortDeployment(db, other, "superseded");
    }
  }

  // A pending restart is overtaken by the deployment.
  cancelTimer(timerKey.service(service.id));
  delete db.pendingRestarts[service.id];
  const container = containerOf(db, service.id);
  if (container?.state === "restarting") container.state = "running";

  const now = iso();
  const deployment: Deployment = {
    id: newId("dep"),
    projectId: service.projectId,
    serviceId: service.id,
    status: "queued",
    trigger: options.trigger,
    commit: options.commit,
    image: options.image ?? imageReferenceFor(db, service, options.commit),
    creator: options.creator ?? db.profile.name,
    progress: 0,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    error: null,
  };
  db.deployments.unshift(deployment);
  service.latestDeploymentId = deployment.id;
  setServiceStatus(db, service, "building");

  const rollback = options.trigger === "rollback";
  addActivity(db, {
    type: rollback ? "deployment.rolled_back" : "deployment.started",
    severity: rollback ? "warning" : "info",
    title: rollback ? "Restauration d’une version" : "Déploiement lancé",
    description: `${service.name} · ${deployment.commit?.message ?? deployment.image ?? ""}`,
    projectId: service.projectId,
    serviceId: service.id,
    deploymentId: deployment.id,
    actor: deployment.creator,
  });

  runDeployment(deployment.id);
  return deployment;
}
