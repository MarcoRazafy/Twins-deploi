/**
 * Thin GitHub REST client over `fetch`. The token only ever travels in the
 * Authorization header: it is never put in a URL, a log line or an error.
 */

import { forbidden, notFound, unavailable } from "../errors";
import { asRecord } from "../rules";

const API_BASE = "https://api.github.com";
const TIMEOUT_MS = 10_000;
const USER_AGENT = "mini-railway";
const PAGE_SIZE = 100;

export interface GithubResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  body: unknown;
}

function isRateLimited(status: number, headers: Headers, body: unknown): boolean {
  if (status === 429) return true;
  if (headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after")) return true;
  const message = asRecord(body).message;
  return typeof message === "string" && /rate limit|abuse/i.test(message);
}

/**
 * One request. Resolves for every status the caller may want to interpret
 * (2xx, 404, 409, 422…) and throws an ApiError for the ones that mean the same
 * thing everywhere: invalid token, missing rights, rate limit, GitHub down,
 * network failure or timeout.
 */
export async function githubRequest(token: string, pathAndQuery: string): Promise<GithubResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${pathAndQuery}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Never let a framework cache answers that depend on a secret.
      cache: "no-store",
    });
  } catch {
    throw unavailable("GitHub est injoignable pour le moment. Réessayez dans un instant.");
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Empty or non-JSON body: the status is what matters.
  }

  if (response.status === 401) throw forbidden("Jeton GitHub invalide ou expiré.");
  if (response.status === 403 || response.status === 429) {
    if (isRateLimited(response.status, response.headers, body)) {
      throw unavailable("La limite de requêtes GitHub est atteinte. Réessayez dans quelques minutes.");
    }
    throw forbidden("Ce jeton GitHub n’a pas les droits nécessaires pour cette opération.");
  }
  if (response.status >= 500) {
    throw unavailable("GitHub rencontre un problème. Réessayez dans un instant.");
  }
  return { status: response.status, ok: response.ok, headers: response.headers, body };
}

/** Like `githubRequest`, but only resolves for a 2xx answer (404 → notFound(`notFoundAs`)). */
export async function githubGet(
  token: string,
  pathAndQuery: string,
  notFoundAs = "Dépôt",
): Promise<GithubResponse> {
  const response = await githubRequest(token, pathAndQuery);
  if (response.ok) return response;
  if (response.status === 404) throw notFound(notFoundAs);
  throw unavailable(`GitHub a répondu de façon inattendue (HTTP ${response.status}).`);
}

/** Items of a paginated list endpoint, at most `maxPages` pages of 100. */
export async function githubList(
  token: string,
  pathAndQuery: string,
  maxPages: number,
): Promise<unknown[]> {
  const items: unknown[] = [];
  const separator = pathAndQuery.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await githubGet(token, `${pathAndQuery}${separator}per_page=${PAGE_SIZE}&page=${page}`);
    if (!Array.isArray(response.body)) throw unavailable("Réponse inattendue de GitHub.");
    items.push(...response.body);
    if (response.body.length < PAGE_SIZE) break;
  }
  return items;
}
