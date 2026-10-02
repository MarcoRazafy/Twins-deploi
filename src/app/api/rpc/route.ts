import { NextResponse, type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/contract";
import { callRpcMethod, createServerApi, getRpcMethods } from "@/server/api";
import {
  authenticate,
  isSecureRequest,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/server/auth";
import { authorize, type Context } from "@/server/context";
import { clientAddress, errorResponse, passesCsrf, readBodyText } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;

type CookieAction = { type: "set"; token: string } | { type: "clear" } | null;

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(error: unknown, authenticated: boolean, label: string): NextResponse {
  const { status, body } = errorResponse(error, authenticated, label);
  return json(body, status);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let label = "rpc";
  let authenticated = true;
  try {
    const text = await readBodyText(request, MAX_BODY_BYTES);
    if (text === null) {
      return json(
        { error: { code: "validation", message: "La requête est trop volumineuse." } },
        413,
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError("validation", "La requête n’est pas un JSON valide.");
    }

    if (!passesCsrf(request.headers)) {
      throw new ApiError("forbidden", "Requête refusée : origine non autorisée.");
    }

    const { method, args = [] } =
      typeof payload === "object" && payload !== null
        ? (payload as { method?: unknown; args?: unknown })
        : {};
    if (typeof method !== "string" || !getRpcMethods().has(method)) {
      throw new ApiError("not_found", "Méthode inconnue.");
    }
    if (!Array.isArray(args)) {
      throw new ApiError("validation", "Les arguments doivent être un tableau.", "args");
    }
    label = method;

    const sessionToken = request.cookies.get(SESSION_COOKIE)?.value ?? null;
    const identity = await authenticate({
      sessionToken,
      authorization: request.headers.get("authorization"),
    });
    authenticated = identity.user !== null;

    let cookieAction: CookieAction =
      identity.via === "session" && identity.refreshed && sessionToken
        ? { type: "set", token: sessionToken }
        : null;
    const ctx: Context = {
      user: identity.user,
      role: identity.user?.role ?? null,
      via: identity.via,
      session: {
        token: sessionToken,
        set: (token) => {
          cookieAction = { type: "set", token };
        },
        clear: () => {
          cookieAction = { type: "clear" };
        },
      },
      client: {
        address: clientAddress(request.headers),
        userAgent: request.headers.get("user-agent"),
      },
    };

    authorize(ctx, method);
    const result = await callRpcMethod(createServerApi(ctx), method, args);

    const response = json({ result }, 200);
    // Read through a widened binding: the closures above assign it, which TypeScript cannot see.
    const action = cookieAction as CookieAction;
    if (action) {
      const options = sessionCookieOptions(
        isSecureRequest(request.url, request.headers.get("x-forwarded-proto")),
      );
      if (action.type === "set") {
        response.cookies.set(SESSION_COOKIE, action.token, options);
      } else {
        response.cookies.set(SESSION_COOKIE, "", { ...options, maxAge: 0 });
      }
    }
    return response;
  } catch (error) {
    return fail(error, authenticated, label);
  }
}
