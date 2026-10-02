/**
 * HTTP implementation of the contract: every method is a POST on /api/rpc,
 * subscriptions are Server-Sent Events. Import-safe during SSR: nothing
 * touches window, fetch or EventSource before a method is actually called.
 */

import type { LogLine } from "@/lib/types";

import {
  ApiError,
  ENTITIES,
  type Api,
  type ApiErrorCode,
  type ApiEvent,
  type Unsubscribe,
} from "./contract";

const RPC_URL = "/api/rpc";
const EVENTS_URL = "/api/events";
const ERROR_CODES: readonly ApiErrorCode[] = [
  "not_found",
  "validation",
  "conflict",
  "forbidden",
  "unavailable",
  "unknown",
];

const OFFLINE_MESSAGE = "Le serveur est injoignable. Vérifiez votre connexion puis réessayez.";

function toApiError(body: unknown, status: number): ApiError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body;
    if (typeof error === "object" && error !== null) {
      const { code, message, field } = error as Record<string, unknown>;
      return new ApiError(
        ERROR_CODES.find((known) => known === code) ?? "unknown",
        typeof message === "string" && message ? message : "Une erreur inattendue est survenue.",
        typeof field === "string" ? field : undefined,
      );
    }
  }
  return status >= 502 && status <= 504
    ? new ApiError("unavailable", OFFLINE_MESSAGE)
    : new ApiError("unknown", "Une erreur inattendue est survenue.");
}

async function call(method: string, args: unknown[]): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(RPC_URL, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Mini-Railway": "1" },
      body: JSON.stringify({ method, args }),
    });
  } catch {
    throw new ApiError("unavailable", OFFLINE_MESSAGE);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (proxy error page…): handled below from the status.
  }
  if (!response.ok) throw toApiError(body, response.status);
  if (typeof body !== "object" || body === null) throw toApiError(null, response.status);
  return (body as { result?: unknown }).result;
}

// ─── Subscriptions ───────────────────────────────────────────────────────────

/** One EventSource for every `events.subscribe` listener of the page. */
function createEventHub(): Api["events"] {
  const listeners = new Set<(event: ApiEvent) => void>();
  let source: EventSource | null = null;
  let interrupted = false;

  const dispatch = (event: ApiEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error(error);
      }
    }
  };

  const open = (): void => {
    if (source || typeof EventSource === "undefined") return;
    source = new EventSource(EVENTS_URL, { withCredentials: true });
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        dispatch(JSON.parse(message.data) as ApiEvent);
      } catch {
        // Malformed frame: ignore it.
      }
    };
    // The browser reconnects by itself; events emitted meanwhile were missed.
    source.onerror = () => {
      interrupted = true;
    };
    source.onopen = () => {
      if (!interrupted) return;
      interrupted = false;
      dispatch({ entities: [...ENTITIES] });
    };
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      open();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && source) {
          source.close();
          source = null;
          interrupted = false;
        }
      };
    },
  };
}

/** Log stream: "data" frames carry LogLine[], the "end" event closes the stream. */
function subscribeLogStream(url: string, onLines: (lines: LogLine[]) => void): Unsubscribe {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(url, { withCredentials: true });
  source.onmessage = (message: MessageEvent<string>) => {
    let lines: unknown;
    try {
      lines = JSON.parse(message.data);
    } catch {
      return;
    }
    if (Array.isArray(lines) && lines.length > 0) onLines(lines as LogLine[]);
  };
  source.addEventListener("end", () => source.close());
  return () => source.close();
}

// ─── The proxy ───────────────────────────────────────────────────────────────

type Method = (...args: unknown[]) => unknown;

export function createHttpApi(): Api {
  const events = createEventHub();
  const local: Record<string, Method> = {
    "events.subscribe": (listener) => events.subscribe(listener as (event: ApiEvent) => void),
    "deployments.subscribeLogs": (id, onLines) =>
      subscribeLogStream(
        `/api/logs/deployments/${encodeURIComponent(String(id))}`,
        onLines as (lines: LogLine[]) => void,
      ),
    "docker.subscribeContainerLogs": (id, onLines) =>
      subscribeLogStream(
        `/api/logs/containers/${encodeURIComponent(String(id))}`,
        onLines as (lines: LogLine[]) => void,
      ),
  };

  const namespaces = new Map<string, Record<string, Method>>();
  const methodsOf = (namespace: string): Record<string, Method> => {
    let proxy = namespaces.get(namespace);
    if (!proxy) {
      const methods = new Map<string, Method>();
      proxy = new Proxy<Record<string, Method>>(
        {},
        {
          get(_target, name) {
            if (typeof name !== "string") return undefined;
            let method = methods.get(name);
            if (!method) {
              const path = `${namespace}.${name}`;
              method = local[path] ?? ((...args: unknown[]) => call(path, args));
              methods.set(name, method);
            }
            return method;
          },
        },
      );
      namespaces.set(namespace, proxy);
    }
    return proxy;
  };

  return new Proxy({} as Api, {
    get(_target, namespace) {
      // "then" must stay undefined so the object is never mistaken for a thenable.
      if (typeof namespace !== "string" || namespace === "then") return undefined;
      return methodsOf(namespace);
    },
  });
}
