import type { Api } from "@/lib/api/contract";
import type { GithubRepo } from "@/lib/types";

import { getDb, save } from "../db";
import { addActivity } from "../domain/activity";
import { imageReferenceFor, startDeployment } from "../domain/deployments";
import {
  addContainer,
  addService,
  defaultConfig,
  resolveServiceName,
} from "../domain/services";
import { addVariable } from "../domain/variables";
import { emit } from "../emitter";
import { forbidden, invalid, notFound } from "../errors";
import { latency } from "../latency";
import { requireProject } from "../lookup";
import type { MockDb } from "../schema";
import { connectedGithub, GITHUB_ACCOUNT, GITHUB_ORGANIZATIONS } from "../seed/github";
import { iso } from "../text";
import { read, write } from "./respond";

function assertConnected(db: MockDb): void {
  if (!db.github.connection.connected) {
    throw forbidden("Connectez votre compte GitHub pour accéder à vos dépôts.");
  }
}

/** Port the framework listens on by default. */
const DEFAULT_PORTS: Record<string, number> = {
  "Next.js": 3000,
  NestJS: 3000,
  Astro: 4321,
  Laravel: 8000,
  Django: 8000,
  FastAPI: 8000,
  Go: 8080,
};

function isNodeProject(repo: GithubRepo): boolean {
  return (
    repo.language === "TypeScript" ||
    repo.language === "JavaScript" ||
    repo.language === "Astro" ||
    ["Next.js", "NestJS", "Astro"].includes(repo.framework ?? "")
  );
}

export const githubApi: Api["github"] = {
  getConnection: () => read((db) => db.github.connection),

  connect: async () => {
    await latency.oauth();
    const db = getDb();
    if (!db.github.connection.connected) {
      db.github.connection = connectedGithub(iso());
      const organizations = GITHUB_ORGANIZATIONS.map((item) => item.login).join(", ");
      addActivity(db, {
        type: "github.connected",
        severity: "success",
        title: "GitHub connecté",
        description: `Compte ${GITHUB_ACCOUNT.login} · organisation ${organizations}`,
      });
      save();
      emit(["github", "activity"]);
    }
    return structuredClone(db.github.connection);
  },

  disconnect: () =>
    write((db) => {
      if (!db.github.connection.connected) return;
      db.github.connection = {
        connected: false,
        account: null,
        organizations: [],
        scopes: [],
        connectedAt: null,
      };
      addActivity(db, {
        type: "github.disconnected",
        severity: "warning",
        title: "GitHub déconnecté",
        description: `Compte ${GITHUB_ACCOUNT.login}`,
      });
      emit(["github", "activity"]);
    }),

  listRepos: (params = {}) =>
    read((db) => {
      assertConnected(db);
      const query = (params.query ?? "").trim().toLowerCase();
      const owner = (params.owner ?? "").trim().toLowerCase();
      return db.github.repos
        .filter(
          (repo) =>
            (owner === "" || repo.owner.toLowerCase() === owner) &&
            (query === "" ||
              repo.name.toLowerCase().includes(query) ||
              repo.description.toLowerCase().includes(query)),
        )
        .sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : a.pushedAt > b.pushedAt ? -1 : 0));
    }),

  listBranches: (repo) =>
    read((db) => {
      assertConnected(db);
      const branches = db.github.branches[repo];
      if (!branches) throw notFound("Dépôt");
      // The default branch first, then the most recently pushed.
      return [...branches].sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.lastCommit.date < b.lastCommit.date ? 1 : -1;
      });
    }),

  importRepo: (input) =>
    write((db) => {
      assertConnected(db);
      const project = requireProject(db, input.projectId);
      const repo = db.github.repos.find((item) => item.fullName === input.repo);
      if (!repo) throw notFound("Dépôt");
      const branch = db.github.branches[repo.fullName]?.find((item) => item.name === input.branch);
      if (!branch) throw invalid("Cette branche n’existe pas dans le dépôt.", "branch");

      const rootDirectory = (input.rootDirectory ?? "/").trim() || "/";
      if (!rootDirectory.startsWith("/")) {
        throw invalid("Le répertoire racine doit commencer par « / ».", "rootDirectory");
      }
      const builder = input.builder ?? db.settings.deployments.defaultBuilder;
      if (builder !== "nixpacks" && builder !== "dockerfile") {
        throw invalid("Ce mode de build n’est pas disponible.", "builder");
      }

      const name = resolveServiceName(db, project.id, input.name, repo.name);
      const port = DEFAULT_PORTS[repo.framework ?? repo.language ?? ""] ?? 3000;
      const service = addService(db, {
        project,
        name,
        source: {
          type: "github",
          repo: repo.fullName,
          branch: branch.name,
          rootDirectory,
          autoDeploy: input.autoDeploy ?? db.settings.deployments.autoDeploy,
        },
        config: defaultConfig(db.settings, { port, builder }),
        volume: null,
        position: input.position,
      });

      const commit = {
        sha: branch.lastCommit.sha,
        message: branch.lastCommit.message,
        author: branch.lastCommit.author,
        branch: branch.name,
      };
      addContainer(db, project, service, imageReferenceFor(db, service, commit));

      addVariable(db, { projectId: project.id, serviceId: service.id, key: "PORT", value: String(port) });
      if (isNodeProject(repo)) {
        addVariable(db, {
          projectId: project.id,
          serviceId: service.id,
          key: "NODE_ENV",
          value: "production",
        });
      }

      addActivity(db, {
        type: "service.created",
        title: "Service créé",
        description: `${name} · dépôt ${repo.fullName}`,
        projectId: project.id,
        serviceId: service.id,
      });
      const deployment = startDeployment(db, service, { trigger: "initial", commit });

      emit(
        ["services", "containers", "variables", "deployments", "projects", "metrics", "activity"],
        { projectId: project.id, serviceId: service.id, deploymentId: deployment.id },
      );
      return service;
    }),
};
