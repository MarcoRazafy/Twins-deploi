import type { Prisma } from "@/generated/prisma/client";
import { ApiError, type Api } from "@/lib/api/contract";
import type { Builder, DeploymentCommit, GithubAccount, GithubBranch, GithubRepo } from "@/lib/types";

import { recordActivity } from "../activity";
import { requireUser, type Context } from "../context";
import { encryptSecret, randomHex, sha256Hex } from "../crypto";
import { db } from "../db";
import { enqueueDeployment } from "../deployments/enqueue";
import { forbidden, notFound, unavailable, validation } from "../errors";
import { emit } from "../events";
import { GITHUB_CONNECTION_ID, getGithubToken } from "../github/auth";
import { resolveBranchTip } from "../git/repository";
import { createTtlCache } from "../github/cache";
import { githubGet, githubList, githubRequest } from "../github/client";
import { firstLine, toGithubBranch, toGithubConnection, toGithubOrganization, toGithubRepo } from "../mappers/github";
import { toService } from "../mappers/service";
import { getPlatformSettings } from "../platform-settings";
import { asRecord, asString } from "../rules";
import { createService } from "../services/create";
import { assertBranch, assertRepo, normalizeRootDirectory } from "../services/validate";
import { createVariable } from "../variables/store";

const NOT_CONNECTED = "Connectez votre compte GitHub pour accéder à vos dépôts.";
const CACHE_TTL_MS = 60_000;
const MAX_REPO_PAGES = 3;
const MAX_BRANCHES = 30;
/** Tip commits are read a few at a time: GitHub's secondary rate limit dislikes bursts. */
const COMMIT_CONCURRENCY = 6;
/** Printable ASCII, no space: valid in a header and in every token format GitHub issues. */
const TOKEN_PATTERN = /^[\x21-\x7e]{1,512}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

const repoCache = createTtlCache<GithubRepo[]>(CACHE_TTL_MS, 20);
const branchCache = createTtlCache<GithubBranch[]>(CACHE_TTL_MS, 200);

function cacheKey(token: string): string {
  return sha256Hex(token).slice(0, 16);
}

function clearCaches(): void {
  repoCache.clear();
  branchCache.clear();
}

async function requireToken(): Promise<string> {
  const token = await getGithubToken();
  if (token === null) throw forbidden(NOT_CONNECTED);
  return token;
}

async function fetchRepos(token: string): Promise<GithubRepo[]> {
  const raw = await githubList(token, "/user/repos?sort=pushed&direction=desc", MAX_REPO_PAGES);
  return raw.flatMap((item) => {
    const repo = toGithubRepo(item);
    return repo ? [repo] : [];
  });
}

async function fetchBranches(token: string, repo: string): Promise<GithubBranch[]> {
  // `repo` went through assertRepo: only [A-Za-z0-9_.-] around one slash.
  const info = await githubGet(token, `/repos/${repo}`);
  const defaultBranch = asString(asRecord(info.body).default_branch);
  const list = await githubGet(token, `/repos/${repo}/branches?per_page=${MAX_BRANCHES}`);
  const entries = Array.isArray(list.body) ? list.body.slice(0, MAX_BRANCHES) : [];

  const branches: GithubBranch[] = [];
  for (let start = 0; start < entries.length; start += COMMIT_CONCURRENCY) {
    const settled = await Promise.all(
      entries.slice(start, start + COMMIT_CONCURRENCY).map(async (entry) => {
        const sha = asString(asRecord(asRecord(entry).commit).sha);
        if (!SHA_PATTERN.test(sha)) return null;
        const commit = await githubGet(token, `/repos/${repo}/git/commits/${sha}`);
        return toGithubBranch(entry, commit.body, defaultBranch);
      }),
    );
    for (const branch of settled) if (branch) branches.push(branch);
  }
  // The default branch first, then the most recently pushed.
  return branches.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.lastCommit.date < b.lastCommit.date ? 1 : a.lastCommit.date > b.lastCommit.date ? -1 : 0;
  });
}

/** Tip of `branch`, read through the API: that is the commit the first deployment builds. */
async function readTipCommit(token: string, repo: string, branch: string): Promise<DeploymentCommit> {
  const response = await githubRequest(
    token,
    `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`,
  );
  if (response.status === 404 || response.status === 422) {
    const known = await githubRequest(token, `/repos/${repo}`);
    if (known.status === 404) throw notFound("Dépôt");
    throw validation("Cette branche n’existe pas dans le dépôt.", "branch");
  }
  if (response.status === 409) {
    throw validation("Ce dépôt est vide : poussez un premier commit avant de l’importer.", "repo");
  }
  if (!response.ok) {
    throw unavailable(`GitHub a répondu de façon inattendue (HTTP ${response.status}).`);
  }

  const tip = asRecord(Array.isArray(response.body) ? response.body[0] : null);
  const sha = asString(tip.sha);
  if (!SHA_PATTERN.test(sha)) throw unavailable("Réponse inattendue de GitHub.");
  const commit = asRecord(tip.commit);
  return {
    sha,
    message: firstLine(asString(commit.message)),
    author: asString(asRecord(commit.author).name) || asString(asRecord(tip.author).login),
    branch,
  };
}

/**
 * Without a GitHub connection only public repositories can be imported: the
 * tip is read anonymously with git. Message and author are filled by the
 * pipeline once the commit is fetched.
 */
async function probePublicTip(repo: string, branch: string): Promise<DeploymentCommit> {
  let sha: string | null;
  try {
    sha = await resolveBranchTip(repo, branch);
  } catch (error) {
    if (error instanceof ApiError && error.code === "forbidden") {
      throw forbidden(
        `Le dépôt ${repo} est privé ou introuvable. Connectez GitHub avec un jeton d’accès pour l’importer.`,
      );
    }
    throw error;
  }
  if (sha === null) throw validation("Cette branche n’existe pas dans le dépôt.", "branch");
  return { sha, message: `Commit ${sha.slice(0, 7)}`, author: "", branch };
}

function parseToken(value: unknown): string {
  const token = asString(value).trim();
  if (token === "") {
    throw validation("Collez un jeton d’accès personnel GitHub pour vous connecter.", "token");
  }
  if (!TOKEN_PATTERN.test(token)) throw validation("Ce jeton GitHub n’est pas valide.", "token");
  return token;
}

function parseBuilder(value: unknown): Builder | undefined {
  if (value === undefined) return undefined;
  if (value === "nixpacks" || value === "dockerfile") return value;
  throw validation("Ce mode de build n’est pas disponible.", "builder");
}

export function createGithubApi(ctx: Context): Api["github"] {
  const actor = (): string => requireUser(ctx).name;

  return {
    async getConnection() {
      const row = await db().githubConnection.findUnique({ where: { id: GITHUB_CONNECTION_ID } });
      return toGithubConnection(row);
    },

    async connect(rawInput) {
      const author = actor();
      const token = parseToken(asRecord(rawInput).token);

      // Rejects with forbidden("Jeton GitHub invalide ou expiré.") for a bad token.
      const profile = await githubGet(token, "/user", "Compte GitHub");
      const user = asRecord(profile.body);
      const login = asString(user.login);
      if (login === "") throw unavailable("Réponse inattendue de GitHub.");

      let organizations: GithubAccount[] = [];
      try {
        organizations = (await githubList(token, "/user/orgs", 1)).flatMap(toGithubOrganization);
      } catch {
        // Organizations are a convenience: a token without that right still connects.
      }
      const scopes = (profile.headers.get("x-oauth-scopes") ?? "")
        .split(",")
        .map((scope) => scope.trim())
        .filter((scope) => scope !== "");

      const row = await db().$transaction(async (tx) => {
        const data = {
          login,
          name: asString(user.name) || login,
          accountType: user.type === "Organization" ? "organization" : "user",
          tokenEncrypted: encryptSecret(token),
          scopes,
          organizations: organizations as unknown as Prisma.InputJsonArray,
          // A fresh secret per connection: the previous webhooks stop being accepted.
          webhookSecretEncrypted: encryptSecret(randomHex(32)),
          connectedAt: new Date(),
        };
        const saved = await tx.githubConnection.upsert({
          where: { id: GITHUB_CONNECTION_ID },
          create: { id: GITHUB_CONNECTION_ID, ...data },
          update: data,
        });
        const names = organizations.map((organization) => organization.login).join(", ");
        await recordActivity(
          {
            type: "github.connected",
            severity: "success",
            title: "GitHub connecté",
            description: `Compte ${login}${names ? ` · organisation ${names}` : ""}`,
            actor: author,
          },
          tx,
        );
        await emit(["github"], {}, tx);
        return saved;
      });
      clearCaches();
      return toGithubConnection(row);
    },

    async disconnect() {
      const author = actor();
      await db().$transaction(async (tx) => {
        const row = await tx.githubConnection.findUnique({
          where: { id: GITHUB_CONNECTION_ID },
          select: { login: true },
        });
        if (!row) return;
        await tx.githubConnection.delete({ where: { id: GITHUB_CONNECTION_ID } });
        await recordActivity(
          {
            type: "github.disconnected",
            severity: "warning",
            title: "GitHub déconnecté",
            description: `Compte ${row.login}`,
            actor: author,
          },
          tx,
        );
        await emit(["github"], {}, tx);
      });
      clearCaches();
    },

    async listRepos(rawParams) {
      const params = asRecord(rawParams);
      const query = asString(params.query).trim().toLowerCase();
      const owner = asString(params.owner).trim().toLowerCase();
      const token = await requireToken();

      const repos = await repoCache.get(cacheKey(token), () => fetchRepos(token));
      return repos
        .filter(
          (repo) =>
            (owner === "" || repo.owner.toLowerCase() === owner) &&
            (query === "" ||
              repo.name.toLowerCase().includes(query) ||
              repo.description.toLowerCase().includes(query)),
        )
        .sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : a.pushedAt > b.pushedAt ? -1 : 0));
    },

    async listBranches(rawRepo) {
      const repo = asString(rawRepo).trim();
      assertRepo(repo, "repo");
      const token = await requireToken();
      return branchCache.get(`${cacheKey(token)}:${repo.toLowerCase()}`, () => fetchBranches(token, repo));
    },

    async importRepo(rawInput) {
      const author = actor();
      const input = asRecord(rawInput);
      const projectId = asString(input.projectId);
      const repo = asString(input.repo).trim();
      const branch = asString(input.branch).trim();
      assertRepo(repo, "repo");
      assertBranch(branch, "branch");
      const rootDirectory = normalizeRootDirectory(asString(input.rootDirectory), "rootDirectory");
      const builder = parseBuilder(input.builder);
      if (input.autoDeploy !== undefined && typeof input.autoDeploy !== "boolean") {
        throw validation("Le déploiement automatique doit être activé ou désactivé.", "autoDeploy");
      }
      const requestedName = asString(input.name).trim();
      const place = asRecord(input.position);
      const position =
        typeof place.x === "number" && typeof place.y === "number" ? { x: place.x, y: place.y } : undefined;

      const project = await db().project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!project) throw notFound("Projet");
      // Network first, so that no transaction stays open while GitHub answers.
      const token = await getGithubToken();
      const commit = token !== null ? await readTipCommit(token, repo, branch) : await probePublicTip(repo, branch);

      const row = await db().$transaction(async (tx) => {
        const settings = await getPlatformSettings(tx);
        const service = await createService(tx, {
          projectId,
          name: requestedName !== "" ? requestedName : repo.split("/")[1],
          explicitName: requestedName !== "",
          source: {
            type: "github",
            repo,
            branch,
            rootDirectory,
            autoDeploy:
              typeof input.autoDeploy === "boolean" ? input.autoDeploy : settings.deployments.autoDeploy,
          },
          config: builder ? { builder } : undefined,
          position,
        });
        await createVariable(tx, {
          projectId,
          serviceId: service.id,
          key: "NODE_ENV",
          value: "production",
          isSecret: false,
        });
        await createVariable(tx, {
          projectId,
          serviceId: service.id,
          key: "PORT",
          value: String(service.port),
          isSecret: false,
        });
        await recordActivity(
          {
            type: "service.created",
            title: "Service créé",
            description: `${service.name} · dépôt ${repo}`,
            projectId,
            serviceId: service.id,
            actor: author,
          },
          tx,
        );
        await enqueueDeployment(tx, { service, trigger: "initial", creator: author, commit });
        await emit(["services", "variables", "projects"], { projectId, serviceId: service.id }, tx);
        // enqueueDeployment moved latestDeploymentId on the row: answer with the fresh one.
        return tx.service.findUniqueOrThrow({ where: { id: service.id } });
      });
      return toService(row);
    },
  };
}
