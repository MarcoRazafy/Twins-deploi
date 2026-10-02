import type { GithubConnection as GithubConnectionRow } from "@/generated/prisma/client";
import type { GithubAccount, GithubBranch, GithubConnection, GithubRepo } from "@/lib/types";

import { asRecord } from "../rules";

const MAX_MESSAGE_LENGTH = 200;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** First line of a commit message, bounded. */
export function firstLine(message: string): string {
  const line = message.split(/\r?\n/, 1)[0].trim();
  return line.length > MAX_MESSAGE_LENGTH ? `${line.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : line;
}

/** The account id is its login: the connection row stores nothing else to tell accounts apart. */
function account(login: string, name: string, type: GithubAccount["type"]): GithubAccount {
  return { id: login, login, name: name || login, type };
}

/** Organization of a GitHub `/user/orgs` answer. */
export function toGithubOrganization(raw: unknown): GithubAccount[] {
  const login = text(asRecord(raw).login);
  return login === "" ? [] : [account(login, "", "organization")];
}

/** Account read back from the JSON column of the connection row. */
function toStoredAccount(raw: unknown): GithubAccount[] {
  const record = asRecord(raw);
  const login = text(record.login);
  if (login === "") return [];
  return [account(login, text(record.name), record.type === "organization" ? "organization" : "user")];
}

/** Never carries the token nor the webhook secret. */
export function toGithubConnection(row: GithubConnectionRow | null): GithubConnection {
  if (!row) {
    return { connected: false, account: null, organizations: [], scopes: [], connectedAt: null };
  }
  return {
    connected: true,
    account: account(row.login, row.name, row.accountType === "organization" ? "organization" : "user"),
    organizations: Array.isArray(row.organizations) ? row.organizations.flatMap(toStoredAccount) : [],
    scopes: row.scopes,
    connectedAt: row.connectedAt.toISOString(),
  };
}

/** Repository of a GitHub `/user/repos` answer; null when the entry is malformed. */
export function toGithubRepo(raw: unknown): GithubRepo | null {
  const repo = asRecord(raw);
  const fullName = text(repo.full_name);
  const owner = text(asRecord(repo.owner).login);
  const name = text(repo.name);
  if (fullName === "" || owner === "" || name === "") return null;
  const id = typeof repo.id === "number" || typeof repo.id === "string" ? String(repo.id) : fullName;
  return {
    id,
    owner,
    name,
    fullName,
    description: text(repo.description),
    private: repo.private === true,
    language: text(repo.language) || null,
    // Detecting the framework would take a request per repository.
    framework: null,
    defaultBranch: text(repo.default_branch) || "main",
    stars: typeof repo.stargazers_count === "number" ? repo.stargazers_count : 0,
    pushedAt: text(repo.pushed_at) || text(repo.updated_at) || new Date(0).toISOString(),
  };
}

/** Branch of `/branches` plus the git commit object (`/git/commits/<sha>`) of its tip. */
export function toGithubBranch(rawBranch: unknown, rawCommit: unknown, defaultBranch: string): GithubBranch | null {
  const branch = asRecord(rawBranch);
  const name = text(branch.name);
  const sha = text(asRecord(branch.commit).sha);
  if (name === "" || sha === "") return null;
  const commit = asRecord(rawCommit);
  const author = asRecord(commit.author);
  return {
    name,
    isDefault: name === defaultBranch,
    protected: branch.protected === true,
    lastCommit: {
      sha,
      message: firstLine(text(commit.message)),
      author: text(author.name) || text(asRecord(commit.committer).name),
      date: text(author.date) || text(asRecord(commit.committer).date) || new Date(0).toISOString(),
    },
  };
}
