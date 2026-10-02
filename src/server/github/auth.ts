/**
 * Access to the stored GitHub credentials. The token is decrypted on demand and
 * only handed to code that needs it (the REST client, git).
 */

import { decryptSecret } from "../crypto";
import { db } from "../db";

/** The platform has a single GitHub connection. */
export const GITHUB_CONNECTION_ID = "default";

export async function getGithubToken(): Promise<string | null> {
  const row = await db().githubConnection.findUnique({
    where: { id: GITHUB_CONNECTION_ID },
    select: { tokenEncrypted: true },
  });
  if (!row) return null;
  try {
    return decryptSecret(row.tokenEncrypted);
  } catch {
    // Sealed with another key: as unusable as no connection.
    console.error("[github] the stored token cannot be decrypted (secret key changed?)");
    return null;
  }
}

/**
 * What git needs to clone a private repository over HTTPS. The pipeline passes
 * it through GIT_CONFIG_* environment variables, never in a command line, a
 * URL or a log.
 */
export async function getGitCredentials(): Promise<{ username: "x-access-token"; token: string } | null> {
  const token = await getGithubToken();
  return token === null ? null : { username: "x-access-token", token };
}
