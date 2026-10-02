import type {
  Deployment,
  DeploymentStatus,
  DeploymentTrigger,
  Project,
  Service,
} from "@/lib/types";

import { CANCELLED_ERROR } from "../domain/deployment-logs";
import { FAIL_POINT, HEALTHCHECK_FAIL_POINT } from "../generators/build-logs";
import { randFloat, seededRng } from "../generators/prng";
import { HOUR, iso, slugify } from "../text";
import { OWNER_NAME, REPO, SVC, type SeedClock } from "./clock";
import { COMMITS, seedSha } from "./github";

type Outcome = "failed-build" | "failed-health" | "cancelled" | "crashed";

interface Step {
  /** Hours before the seeding moment. */
  ago: number;
  trigger: DeploymentTrigger;
  /** Build + deploy duration. */
  seconds: number;
  /** GitHub services: index in the commit pool of the repository. */
  commit?: number;
  /** Docker services: tag deployed from this step on. */
  tag?: string;
  /** Omitted = successful. */
  outcome?: Outcome;
}

interface History {
  key: string;
  serviceId: string;
  repo?: keyof typeof REPO;
  steps: Step[];
}

export const CRASH_ERROR = "Le processus s’est arrêté avec le code 1";

/** Fourteen days of activity (336 h), plus the older first deployments. */
const HISTORIES: History[] = [
  {
    key: "cancham_postgres",
    serviceId: SVC.canchamPostgres,
    steps: [{ ago: 431.5, trigger: "initial", seconds: 36 }],
  },
  {
    key: "cancham_app",
    serviceId: SVC.canchamApp,
    repo: "canchamApp",
    steps: [
      { ago: 430, trigger: "initial", seconds: 184, commit: 0 },
      { ago: 318, trigger: "push", seconds: 172, commit: 1 },
      { ago: 286, trigger: "push", seconds: 165, commit: 2 },
      { ago: 219, trigger: "push", seconds: 201, commit: 3 },
      { ago: 213.5, trigger: "config", seconds: 158, commit: 3 },
      { ago: 151, trigger: "push", seconds: 176, commit: 4 },
      { ago: 101.2, trigger: "push", seconds: 58, commit: 5, outcome: "failed-build" },
      { ago: 100.4, trigger: "push", seconds: 169, commit: 6 },
      { ago: 48.6, trigger: "push", seconds: 181, commit: 7 },
      { ago: 26.3, trigger: "redeploy", seconds: 149, commit: 7 },
      { ago: 5.4, trigger: "push", seconds: 174, commit: 8 },
    ],
  },
  {
    key: "boutique_postgres",
    serviceId: SVC.boutiquePostgres,
    steps: [{ ago: 1127, trigger: "initial", seconds: 38 }],
  },
  {
    key: "boutique_redis",
    serviceId: SVC.boutiqueRedis,
    steps: [
      { ago: 1126, trigger: "initial", seconds: 24, tag: "7-alpine" },
      { ago: 238, trigger: "config", seconds: 21 },
    ],
  },
  {
    key: "boutique_storefront",
    serviceId: SVC.boutiqueStorefront,
    repo: "storefront",
    steps: [
      { ago: 1104, trigger: "initial", seconds: 196, commit: 0 },
      { ago: 297, trigger: "push", seconds: 188, commit: 1 },
      { ago: 245, trigger: "push", seconds: 203, commit: 2 },
      { ago: 187, trigger: "push", seconds: 179, commit: 3 },
      { ago: 166, trigger: "manual", seconds: 171, commit: 3 },
      { ago: 122, trigger: "push", seconds: 194, commit: 4 },
      { ago: 79.5, trigger: "push", seconds: 41, commit: 5, outcome: "cancelled" },
      { ago: 79.1, trigger: "push", seconds: 186, commit: 6 },
      { ago: 26.8, trigger: "push", seconds: 191, commit: 7 },
    ],
  },
  {
    key: "boutique_api",
    serviceId: SVC.boutiqueApi,
    repo: "api",
    steps: [
      { ago: 1103, trigger: "initial", seconds: 124, commit: 0 },
      { ago: 324, trigger: "push", seconds: 96, commit: 1 },
      { ago: 266, trigger: "push", seconds: 104, commit: 2 },
      { ago: 230.6, trigger: "push", seconds: 117, commit: 3, outcome: "failed-health" },
      { ago: 229.8, trigger: "push", seconds: 99, commit: 4 },
      { ago: 172, trigger: "push", seconds: 101, commit: 5 },
      { ago: 120, trigger: "push", seconds: 93, commit: 6 },
      { ago: 62.5, trigger: "rollback", seconds: 71, commit: 5 },
      { ago: 57.4, trigger: "push", seconds: 108, commit: 7 },
      { ago: 17.2, trigger: "push", seconds: 97, commit: 8 },
    ],
  },
  {
    key: "boutique_worker",
    serviceId: SVC.boutiqueWorker,
    steps: [
      { ago: 1102, trigger: "initial", seconds: 44, tag: "1.6.0" },
      { ago: 480, trigger: "manual", seconds: 41, tag: "1.7.3" },
      { ago: 199, trigger: "manual", seconds: 47, tag: "1.8.0" },
      { ago: 45.5, trigger: "manual", seconds: 43, tag: "1.8.1" },
      { ago: 3.1, trigger: "manual", seconds: 46, tag: "1.8.2", outcome: "crashed" },
    ],
  },
  {
    key: "observatoire_postgres",
    serviceId: SVC.observatoirePostgres,
    steps: [{ ago: 1726, trigger: "initial", seconds: 41 }],
  },
  {
    key: "observatoire_metabase",
    serviceId: SVC.observatoireMetabase,
    steps: [
      { ago: 1702, trigger: "initial", seconds: 92, tag: "v0.49.22" },
      { ago: 307, trigger: "manual", seconds: 88, tag: "v0.50.20" },
      { ago: 144, trigger: "config", seconds: 81 },
    ],
  },
  {
    key: "portfolio_site",
    serviceId: SVC.portfolioSite,
    repo: "portfolio",
    steps: [
      { ago: 3096, trigger: "initial", seconds: 52, commit: 0 },
      { ago: 1464, trigger: "push", seconds: 47, commit: 1 },
      { ago: 792, trigger: "push", seconds: 49, commit: 2 },
      { ago: 252, trigger: "push", seconds: 44, commit: 3 },
    ],
  },
];

/** The deployment a fresh demo shows in flight. */
export const IN_FLIGHT_DEPLOYMENT_ID = "dep_observatoire_n8n_01";

function statusOf(outcome: Outcome | undefined): { status: DeploymentStatus; progress: number } {
  switch (outcome) {
    case "failed-build":
      return { status: "failed", progress: FAIL_POINT };
    case "failed-health":
      return { status: "failed", progress: HEALTHCHECK_FAIL_POINT };
    case "cancelled":
      return { status: "cancelled", progress: 34 };
    case "crashed":
      return { status: "crashed", progress: 100 };
    default:
      // The newest successful step is promoted to "active" below.
      return { status: "removed", progress: 100 };
  }
}

/**
 * Builds the deployment history and links each service to its latest and
 * active deployments. `error` of failed deployments is filled in afterwards,
 * from the same generator that produces their logs.
 */
export function seedDeployments(
  clock: SeedClock,
  services: Service[],
  projects: Project[],
  registryHost: string,
): Deployment[] {
  const deployments: Deployment[] = [];

  for (const history of HISTORIES) {
    const service = services.find((item) => item.id === history.serviceId);
    const project = projects.find((item) => item.id === service?.projectId);
    if (!service || !project) continue;
    const rng = seededRng("history", history.key);
    const source = service.source;
    let tag = source.type === "docker" ? source.tag : "";
    let active: Deployment | null = null;

    for (const [index, step] of history.steps.entries()) {
      const createdAt = clock.now - step.ago * HOUR;
      const startedAt = createdAt + randFloat(rng, 1_200, 3_000);
      const finishedAt = startedAt + step.seconds * 1000;
      const { status, progress } = statusOf(step.outcome);
      if (step.tag) tag = step.tag;

      let commit: Deployment["commit"] = null;
      let image: string;
      if (source.type === "github" && history.repo) {
        const seedCommit = COMMITS[history.repo][step.commit ?? 0];
        commit = {
          sha: seedSha(REPO[history.repo], step.commit ?? 0),
          message: seedCommit.message,
          author: seedCommit.author,
          branch: source.branch,
        };
        image = `${registryHost}/${project.slug}/${slugify(service.name)}:${commit.sha.slice(0, 7)}`;
      } else if (source.type === "docker") {
        image = `${source.image}:${tag}`;
      } else {
        image = `postgres:${source.type === "postgres" ? source.version : "17"}`;
      }

      const deployment: Deployment = {
        id: `dep_${history.key}_${String(index + 1).padStart(2, "0")}`,
        projectId: project.id,
        serviceId: service.id,
        status,
        trigger: step.trigger,
        commit,
        image,
        creator: step.trigger === "push" && commit ? commit.author : OWNER_NAME,
        progress,
        createdAt: iso(createdAt),
        startedAt: iso(startedAt),
        finishedAt: iso(finishedAt),
        durationMs: step.seconds * 1000,
        error:
          step.outcome === "cancelled"
            ? CANCELLED_ERROR
            : step.outcome === "crashed"
              ? CRASH_ERROR
              : null,
      };
      deployments.push(deployment);
      service.latestDeploymentId = deployment.id;
      if (step.outcome === undefined) active = deployment;
      // A release that crashed had replaced the previous one first.
      if (step.outcome === "crashed") active = null;
    }

    if (active) {
      active.status = "active";
      service.activeDeploymentId = active.id;
    }
  }

  const n8n = services.find((item) => item.id === SVC.observatoireN8n);
  if (n8n && n8n.source.type === "docker") {
    deployments.push({
      id: IN_FLIGHT_DEPLOYMENT_ID,
      projectId: n8n.projectId,
      serviceId: n8n.id,
      status: "building",
      trigger: "initial",
      commit: null,
      image: `${n8n.source.image}:${n8n.source.tag}`,
      creator: OWNER_NAME,
      progress: 35,
      createdAt: clock.secondsAgo(3.2),
      startedAt: clock.secondsAgo(2),
      finishedAt: null,
      durationMs: null,
      error: null,
    });
    n8n.latestDeploymentId = IN_FLIGHT_DEPLOYMENT_ID;
  }

  return deployments;
}
