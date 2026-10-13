/**
 * Terminal service of the server console: a WebSocket server that gives the
 * owner an interactive shell on the host (docs/BACKEND.md, section 11).
 *
 * It is a process of its own (src/terminal/main.ts), on the loopback only;
 * the browser reaches it through NGINX and a Next.js rewrite. Every rule is
 * enforced here, at the handshake and then all along the session:
 * - same-origin browser request carrying the session cookie of the owner
 *   (API tokens are not accepted);
 * - the switch of the Settings is on;
 * - a bounded number of terminals, closed when idle, when the browser leaves,
 *   when the owner signs out or when the switch goes off;
 * - every opening and closing is written to the activity journal.
 */

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer, type RawData, type WebSocket } from "ws";

import {
  CONSOLE_CLOSE,
  CONSOLE_LIMITS,
  consoleSize,
  parseConsoleClientMessage,
  type ConsoleCloseReason,
  type ConsoleServerMessage,
} from "@/lib/server-console";
import type { UserProfile } from "@/lib/types";

import { recordActivity } from "../activity";
import { authenticate } from "../auth";
import { hasRole } from "../context";
import { clientAddress } from "../http";
import { formatSessionDuration, isSameOrigin, sessionTokenFromCookies } from "./policy";
import { getServerConsoleStatus } from "./settings";
import { openShell, type Shell } from "./shell";

const WS_PATH = "/ws";
const HEALTH_PATH = "/healthz";
/** A paste can be large; anything bigger than this is not typing. */
const MAX_MESSAGE_BYTES = 1024 * 1024;
/** The shell is paused while the browser is this far behind. */
const OUTPUT_HIGH_WATER_BYTES = 1024 * 1024;
const OUTPUT_LOW_WATER_BYTES = 256 * 1024;
/** Sessions are closed when they could not be re-validated this many times in a row. */
const MAX_FAILED_RECHECKS = 3;
const SHUTDOWN_GRACE_MS = 10_000;

export interface TerminalServerOptions {
  /** Directory every shell starts in. */
  cwd: string;
  maxSessions?: number;
  idleTimeoutMs?: number;
  /** How often open sessions are re-validated (switch, owner session, idleness). */
  recheckIntervalMs?: number;
  /** WebSocket ping period: detects dead connections, keeps NGINX from timing out. */
  pingIntervalMs?: number;
  log?: (message: string) => void;
}

export interface TerminalServer {
  http: Server;
  sessionCount(): number;
  /** Ends every session, waits for the shells to be gone, stops listening. */
  close(): Promise<void>;
}

type EndReason = Exclude<ConsoleCloseReason, "tooManySessions">;

/** Wording of the activity journal. */
const END_LABELS: Record<EndReason, string> = {
  disconnected: "onglet fermé ou connexion coupée",
  idle: "inactivité",
  disabled: "console désactivée",
  signedOut: "session de connexion terminée",
  shellExited: "shell terminé",
  serverStopping: "arrêt du service",
};

interface Session {
  id: string;
  user: UserProfile;
  address: string;
  /** Session cookie the terminal was opened with, re-validated all along. */
  token: string;
  socket: WebSocket;
  shell: Shell;
  openedAt: number;
  lastInputAt: number;
  /** A pong came back since the last ping. */
  alive: boolean;
  ending: EndReason | null;
}

type Admission =
  | { ok: true; user: UserProfile; token: string; address: string }
  | { ok: false; status: 401 | 403 | 404; reason: string; address: string };

const STATUS_TEXT = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found" } as const;

function toHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function refuse(socket: Duplex, status: keyof typeof STATUS_TEXT): void {
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

export function createTerminalServer(options: TerminalServerOptions): TerminalServer {
  const maxSessions = options.maxSessions ?? CONSOLE_LIMITS.maxSessions;
  const idleTimeoutMs = options.idleTimeoutMs ?? CONSOLE_LIMITS.idleTimeoutMs;
  const recheckIntervalMs = options.recheckIntervalMs ?? 10_000;
  const pingIntervalMs = options.pingIntervalMs ?? 25_000;
  const log = options.log ?? (() => {});

  const sessions = new Map<string, Session>();
  let failedRechecks = 0;
  let stopping = false;

  /** Whether `token` is, right now, the browser session of an owner. */
  async function ownerOf(token: string): Promise<UserProfile | null> {
    const identity = await authenticate({ sessionToken: token, authorization: null });
    if (identity.via !== "session" || identity.user === null) return null;
    return hasRole(identity.user.role, "owner") ? identity.user : null;
  }

  async function admit(request: IncomingMessage): Promise<Admission> {
    const headers = toHeaders(request);
    const address = clientAddress(headers);
    const pathname = new URL(request.url ?? "/", "http://terminal.invalid").pathname;
    if (pathname !== WS_PATH) return { ok: false, status: 404, reason: "unknown path", address };
    if (!isSameOrigin(headers)) return { ok: false, status: 403, reason: "foreign or missing origin", address };

    const token = sessionTokenFromCookies(headers.get("cookie"));
    if (token === null) return { ok: false, status: 401, reason: "no session", address };
    const identity = await authenticate({ sessionToken: token, authorization: null });
    if (identity.via !== "session" || identity.user === null) {
      return { ok: false, status: 401, reason: "invalid session", address };
    }
    if (!hasRole(identity.user.role, "owner")) {
      return { ok: false, status: 403, reason: `role ${identity.user.role} (${identity.user.email})`, address };
    }
    if (!(await getServerConsoleStatus()).enabled) {
      return { ok: false, status: 403, reason: `console disabled (${identity.user.email})`, address };
    }
    return { ok: true, user: identity.user, token, address };
  }

  async function journal(
    session: Session,
    type: "console.opened" | "console.closed",
    detail?: string,
  ): Promise<void> {
    const opened = type === "console.opened";
    try {
      await recordActivity({
        type,
        severity: opened ? "warning" : "info",
        title: opened ? "Console du serveur ouverte" : "Console du serveur fermée",
        description: [session.user.email, session.address, detail].filter(Boolean).join(" · "),
        actor: session.user.name,
      });
    } catch (error) {
      // The journal line in the logs below remains.
      log(`cannot write the activity journal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function end(session: Session, reason: EndReason): void {
    if (session.ending) return;
    session.ending = reason;
    if (reason !== "disconnected" && session.socket.readyState === session.socket.OPEN) {
      session.socket.close(CONSOLE_CLOSE[reason]);
    }
    session.shell.close();
  }

  function start(socket: WebSocket, admission: Extract<Admission, { ok: true }>, request: IncomingMessage): void {
    const query = new URL(request.url ?? "/", "http://terminal.invalid").searchParams;
    const size = consoleSize(query.get("cols"), query.get("rows"));
    const id = randomBytes(8).toString("hex");
    const now = Date.now();

    const session: Session = {
      id,
      user: admission.user,
      address: admission.address,
      token: admission.token,
      socket,
      openedAt: now,
      lastInputAt: now,
      alive: true,
      ending: null,
      shell: openShell({
        cwd: options.cwd,
        cols: size.cols,
        rows: size.rows,
        marker: id,
        onLog: (line) => log(`session ${id}: ${line}`),
        onData: (chunk) => {
          if (socket.readyState !== socket.OPEN) return;
          socket.send(chunk, { binary: true }, () => {
            if (socket.bufferedAmount < OUTPUT_LOW_WATER_BYTES) session.shell.resume();
          });
          if (socket.bufferedAmount > OUTPUT_HIGH_WATER_BYTES) session.shell.pause();
        },
        onExit: (code) => {
          // The shell and everything it started are gone: only now is the session over.
          const reason = session.ending ?? "shellExited";
          session.ending = reason;
          sessions.delete(id);
          if (socket.readyState === socket.OPEN) {
            const message: ConsoleServerMessage = { type: "exit", code };
            socket.send(JSON.stringify(message));
            socket.close(CONSOLE_CLOSE.shellExited);
          }
          const duration = formatSessionDuration(Date.now() - session.openedAt);
          log(`session ${id} closed (${reason}) for ${session.user.email} from ${session.address} after ${duration}`);
          void journal(session, "console.closed", `${END_LABELS[reason]} · ${duration}`);
        },
      }),
    };
    sessions.set(id, session);
    log(`session ${id} opened by ${session.user.email} from ${session.address}`);
    void journal(session, "console.opened");

    socket.on("message", (data, isBinary) => {
      if (session.ending) return;
      if (isBinary) {
        session.lastInputAt = Date.now();
        session.shell.write(toBuffer(data));
        return;
      }
      const message = parseConsoleClientMessage(toBuffer(data).toString("utf8"));
      if (message?.type === "resize") session.shell.resize(message.cols, message.rows);
    });
    socket.on("pong", () => {
      session.alive = true;
    });
    socket.on("close", () => end(session, "disconnected"));
    socket.on("error", () => end(session, "disconnected"));
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });

  const http = createServer((request, response) => {
    // Plain HTTP serves nothing but a liveness probe.
    const healthy = request.method === "GET" && request.url === HEALTH_PATH;
    response.writeHead(healthy ? 200 : 404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    response.end(healthy ? "ok\n" : "");
  });

  http.on("upgrade", (request, socket, head) => {
    socket.on("error", () => {});
    void (async () => {
      let admission: Admission;
      try {
        admission = stopping
          ? { ok: false, status: 403, reason: "service stopping", address: "local" }
          : await admit(request);
      } catch (error) {
        // Database unreachable, for instance: nobody gets in.
        log(`handshake failed: ${error instanceof Error ? error.message : String(error)}`);
        refuse(socket, 403);
        return;
      }
      if (!admission.ok) {
        log(`refused (${admission.status}, ${admission.reason}) from ${admission.address}`);
        refuse(socket, admission.status);
        return;
      }
      wss.handleUpgrade(request, socket, head, (client) => {
        // Checked here, synchronously with the registration: two handshakes cannot both take the last slot.
        if (sessions.size >= maxSessions) {
          log(`refused (too many sessions) for ${admission.user.email} from ${admission.address}`);
          client.close(CONSOLE_CLOSE.tooManySessions);
          return;
        }
        start(client, admission, request);
      });
    })();
  });

  const recheck = setInterval(() => {
    if (sessions.size === 0) return;
    void (async () => {
      const now = Date.now();
      for (const session of sessions.values()) {
        if (now - session.lastInputAt > idleTimeoutMs) end(session, "idle");
      }
      try {
        const enabled = (await getServerConsoleStatus()).enabled;
        for (const session of [...sessions.values()]) {
          if (session.ending) continue;
          if (!enabled) {
            end(session, "disabled");
            continue;
          }
          const owner = await ownerOf(session.token);
          if (owner === null || owner.id !== session.user.id) end(session, "signedOut");
        }
        failedRechecks = 0;
      } catch (error) {
        failedRechecks += 1;
        log(`cannot re-validate the sessions: ${error instanceof Error ? error.message : String(error)}`);
        if (failedRechecks >= MAX_FAILED_RECHECKS) {
          for (const session of sessions.values()) end(session, "signedOut");
        }
      }
    })();
  }, recheckIntervalMs);

  const ping = setInterval(() => {
    for (const session of sessions.values()) {
      if (session.ending) continue;
      if (!session.alive) {
        session.socket.terminate();
        end(session, "disconnected");
        continue;
      }
      session.alive = false;
      session.socket.ping();
    }
  }, pingIntervalMs);

  return {
    http,
    sessionCount: () => sessions.size,
    async close() {
      stopping = true;
      clearInterval(recheck);
      clearInterval(ping);
      for (const session of sessions.values()) end(session, "serverStopping");
      const deadline = Date.now() + SHUTDOWN_GRACE_MS;
      while (sessions.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    },
  };
}
