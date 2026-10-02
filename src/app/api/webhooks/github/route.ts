/**
 * GitHub webhook: deploys a service as soon as its branch receives a push,
 * without waiting for the worker's next synchronisation (60 s).
 *
 * URL:           https://<platform domain>/api/webhooks/github
 * To configure:  repository (or organisation) settings on GitHub > Webhooks >
 *                Add webhook; payload URL above; content type
 *                "application/json"; secret = the webhook secret of the GitHub
 *                connection (generated when the account is connected, stored
 *                encrypted in github_connections); events: "Just the push event".
 *
 * There is no session here: the request is authenticated by its
 * X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with that secret).
 */

import { createHmac } from "node:crypto";

import { NextResponse } from "next/server";

import { decryptSecret, safeEqual } from "@/server/crypto";
import { db } from "@/server/db";
import { GITHUB_CONNECTION_ID } from "@/server/github/auth";
import { readBodyText } from "@/server/http";
import { asRecord, asString } from "@/server/rules";
import { assertBranch, assertRepo } from "@/server/services/validate";
import { checkServiceForNewCommit, type KnownTip } from "@/server/sync/git-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;
const BRANCH_REF_PREFIX = "refs/heads/";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DELETED_SHA = "0".repeat(40);

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function refuse(status: number, message: string): NextResponse {
  return json({ ok: false, error: message }, status);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // The raw body first: the signature covers its exact bytes.
    const body = await readBodyText(request, MAX_BODY_BYTES);
    if (body === null) return refuse(413, "Payload too large.");

    const connection = await db().githubConnection.findUnique({
      where: { id: GITHUB_CONNECTION_ID },
      select: { webhookSecretEncrypted: true },
    });
    if (!connection) return refuse(404, "No GitHub connection.");

    let secret: string;
    try {
      secret = decryptSecret(connection.webhookSecretEncrypted);
    } catch {
      console.error("[webhook] the webhook secret cannot be decrypted (secret key changed?)");
      return refuse(401, "Invalid signature.");
    }
    const expected = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    const received = request.headers.get("x-hub-signature-256") ?? "";
    // safeEqual compares digests of both values: constant time whatever their lengths.
    if (!safeEqual(received, expected)) return refuse(401, "Invalid signature.");

    const event = request.headers.get("x-github-event") ?? "";
    if (event === "ping") return json({ ok: true, event, message: "pong" }, 200);
    if (event !== "push") return json({ ok: true, event, ignored: "event not handled", queued: [] }, 200);

    let payload: Record<string, unknown>;
    try {
      payload = asRecord(JSON.parse(body));
    } catch {
      return refuse(400, "The payload is not valid JSON (set the webhook content type to application/json).");
    }
    const ref = asString(payload.ref);
    const repo = asString(asRecord(payload.repository).full_name);
    const after = asString(payload.after);
    if (!ref.startsWith(BRANCH_REF_PREFIX)) {
      return json({ ok: true, event, ignored: "not a branch", queued: [] }, 200);
    }
    const branch = ref.slice(BRANCH_REF_PREFIX.length);
    try {
      assertRepo(repo, "repository");
      assertBranch(branch, "ref");
    } catch {
      return refuse(400, "Unexpected repository or branch name.");
    }
    if (payload.deleted === true || after === DELETED_SHA) {
      return json({ ok: true, event, repo, branch, ignored: "branch deleted", queued: [] }, 200);
    }

    const head = asRecord(payload.head_commit);
    const known: KnownTip | undefined = SHA_PATTERN.test(after)
      ? {
          sha: after,
          message: asString(head.message).split("\n")[0].slice(0, 200),
          author: asString(asRecord(head.author).name).slice(0, 100),
        }
      : undefined;

    const services = await db().service.findMany({
      // GitHub names are case-insensitive; branches are not.
      where: { type: "github", autoDeploy: true, branch, repo: { equals: repo, mode: "insensitive" } },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    const results: Array<{ serviceId: string; service: string; status: string; reason?: string; deploymentId?: string }> = [];
    for (const service of services) {
      try {
        const outcome = await checkServiceForNewCommit(service.id, known);
        results.push({
          serviceId: service.id,
          service: service.name,
          status: outcome.status,
          reason: outcome.reason,
          deploymentId: outcome.deploymentId,
        });
      } catch (error) {
        console.error(`[webhook] could not check service ${service.id}:`, error instanceof Error ? error.message : error);
        results.push({ serviceId: service.id, service: service.name, status: "error" });
      }
    }
    return json(
      {
        ok: true,
        event,
        repo,
        branch,
        commit: known?.sha ?? null,
        queued: results.filter((result) => result.status === "queued"),
        services: results,
      },
      200,
    );
  } catch (error) {
    console.error("[webhook] unexpected failure:", error instanceof Error ? error.message : error);
    return refuse(500, "Internal error.");
  }
}
