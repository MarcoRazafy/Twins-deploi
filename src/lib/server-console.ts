/**
 * Wire protocol of the server console ("Console" page), shared by the browser
 * and by the terminal service (src/server/terminal). Pure: no DOM, no Node.
 *
 * One WebSocket per terminal:
 * - binary frames carry the bytes of the terminal, both ways;
 * - text frames carry a JSON control message (`ConsoleClientMessage` from the
 *   browser, `ConsoleServerMessage` from the server);
 * - the close code says why the session ended (`CONSOLE_CLOSE`).
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
} as const;

export type ConsoleCloseReason = keyof typeof CONSOLE_CLOSE | "disconnected";

export type ConsoleClientMessage = { type: "resize"; cols: number; rows: number };

export type ConsoleServerMessage = { type: "exit"; code: number | null };

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
  disconnected: "Connexion interrompue ou refusée. La session est terminée sur le serveur.",
};
