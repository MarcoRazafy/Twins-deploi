/**
 * Wire protocol of the server console ("Console" page), shared by the browser
 * and by the terminal service (src/server/terminal). Pure: no DOM, no Node.
 *
 * One WebSocket per terminal:
 * - binary frames carry the bytes of the terminal, both ways;
 * - text frames carry a JSON control message (`ConsoleClientMessage` from the
 *   browser, `ConsoleServerMessage` from the server);
 * - the close code says why the connection ended (`CONSOLE_CLOSE`).
 *
 * A terminal outlives its connection: when the browser leaves the page, the
 * shell keeps running on the server until the owner comes back (the query
 * string `session=<id>`, or the most recent detached terminal of the owner),
 * closes it, or leaves it idle for `CONSOLE_LIMITS.idleTimeoutMs`.
 * `new=1` asks for a new terminal instead.
 */

/** Path the browser connects to (rewritten by Next.js to the terminal service). */
export const CONSOLE_WS_PATH = "/api/terminal/ws";

export const CONSOLE_LIMITS = {
  /** Terminals open at the same time, all owners and tabs together. */
  maxSessions: 2,
  /** A terminal nobody types in is closed after this long. */
  idleTimeoutMs: 30 * 60 * 1000,
  cols: { min: 20, max: 500, fallback: 80 },
  rows: { min: 5, max: 200, fallback: 24 },
} as const;

/** WebSocket close codes of the application range (4000-4999). */
export const CONSOLE_CLOSE = {
  idle: 4000,
  disabled: 4001,
  tooManySessions: 4002,
  signedOut: 4003,
  shellExited: 4004,
  serverStopping: 4005,
  /** The owner closed the terminal ("Fermer la session"). */
  closed: 4006,
  /** The same terminal was resumed from another tab: this connection lets go of it. */
  takenOver: 4007,
} as const;

export type ConsoleCloseReason = keyof typeof CONSOLE_CLOSE | "disconnected";

export type ConsoleClientMessage = { type: "resize"; cols: number; rows: number } | { type: "close" };

export type ConsoleServerMessage =
  /** First message of every connection: the terminal it is attached to. */
  | { type: "session"; id: string; resumed: boolean }
  | { type: "exit"; code: number | null };

/** Id of a terminal, as the service generates it (and accepts it back in `session=`). */
export function isConsoleSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "string" && /^\d{1,6}$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Terminal size from untrusted input, always within the accepted bounds. */
export function consoleSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const { cols: c, rows: r } = CONSOLE_LIMITS;
  return {
    cols: clampInteger(cols, c.min, c.max, c.fallback),
    rows: clampInteger(rows, r.min, r.max, r.fallback),
  };
}

/** A control message of the browser, or null for anything else. */
export function parseConsoleClientMessage(text: string): ConsoleClientMessage | null {
  if (text.length > 200) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  if (message.type === "close") return { type: "close" };
  if (message.type !== "resize") return null;
  if (!Number.isInteger(message.cols) || !Number.isInteger(message.rows)) return null;
  return { type: "resize", ...consoleSize(message.cols, message.rows) };
}

export function consoleCloseReason(code: number): ConsoleCloseReason {
  const known = (Object.keys(CONSOLE_CLOSE) as Array<keyof typeof CONSOLE_CLOSE>).find(
    (reason) => CONSOLE_CLOSE[reason] === code,
  );
  return known ?? "disconnected";
}

/** What the page tells the owner once a terminal is closed. */
export const CONSOLE_CLOSE_MESSAGES: Record<ConsoleCloseReason, string> = {
  idle: "Session fermée après 30 minutes sans saisie.",
  disabled: "La console du serveur a été désactivée dans les Settings.",
  tooManySessions: "Deux sessions sont déjà ouvertes. Fermez-en une, puis réessayez.",
  signedOut: "Votre session de connexion n’est plus valide. Reconnectez-vous.",
  shellExited: "Le shell s’est terminé.",
  serverStopping: "Le service de console redémarre. Rouvrez une session dans un instant.",
  closed: "Session fermée.",
  takenOver: "Cette session a été reprise dans un autre onglet.",
  disconnected: "Connexion interrompue. Le shell continue sur le serveur : reprenez la session pour le retrouver.",
};
