import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { CONSOLE_CLOSE } from "@/lib/server-console";
import type { UserProfile } from "@/lib/types";
import { createServerApi } from "@/server/api";
import { createSession, destroySession } from "@/server/auth";
import { authorize, minimumRole, systemContext, type Context } from "@/server/context";
import { db } from "@/server/db";
import { getServerConsoleStatus } from "@/server/terminal/settings";
import { createTerminalServer, type TerminalServer } from "@/server/terminal/server";
import { resetDatabase } from "../helpers/db";
import { apiAs, createMember, expectApiError, OWNER, setupOwner } from "../helpers/api";

const ORIGIN = "https://platform.test";
/** The bridge refuses to open a root shell: the terminals below need an ordinary account. */
const canOpenShells = process.getuid?.() !== 0;

let owner: UserProfile;

/** Context of a request made from the browser, like the RPC route builds it. */
function browserContext(user: UserProfile): Context {
  return { ...systemContext(user), via: "session", client: { address: "203.0.113.7", userAgent: "vitest" } };
}

async function enableConsole(): Promise<void> {
  await createServerApi(browserContext(owner)).settings.setServerConsole({ enabled: true, password: OWNER.password });
}

beforeEach(async () => {
  await resetDatabase();
  owner = await setupOwner();
});

describe("settings.getServerConsole / setServerConsole", () => {
  it("is off on a fresh installation", async () => {
    expect(await apiAs(owner).settings.getServerConsole()).toEqual({ enabled: false, updatedBy: null, updatedAt: null });
  });

  it("belongs to the owner alone, reads included", async () => {
    expect(minimumRole("settings.getServerConsole")).toBe("owner");
    expect(minimumRole("settings.setServerConsole")).toBe("owner");
    for (const role of ["admin", "developer", "viewer"] as const) {
      const member = await createMember(owner, role);
      await expectApiError(apiAs(member).settings.getServerConsole(), "forbidden");
      await expectApiError(apiAs(member).settings.setServerConsole({ enabled: true, password: OWNER.password }), "forbidden");
      // Even if the RPC guard were bypassed, the method itself refuses.
      const unguarded = createServerApi(browserContext(member)).settings;
      await expectApiError(unguarded.setServerConsole({ enabled: true, password: OWNER.password }), "forbidden");
      await expectApiError(unguarded.getServerConsole(), "forbidden");
    }
    expect((await getServerConsoleStatus()).enabled).toBe(false);
  });

  it("asks for the owner's password to turn it on, and refuses an API token", async () => {
    const browser = createServerApi(browserContext(owner)).settings;
    const wrong = await expectApiError(browser.setServerConsole({ enabled: true, password: "pas-le-bon" }), "validation");
    expect(wrong.field).toBe("password");
    await expectApiError(browser.setServerConsole({ enabled: true }), "validation");
    // systemContext is `via: "token"`: what an API token of the owner would be.
    await expectApiError(apiAs(owner).settings.setServerConsole({ enabled: true, password: OWNER.password }), "forbidden");
    expect((await getServerConsoleStatus()).enabled).toBe(false);

    const status = await browser.setServerConsole({ enabled: true, password: OWNER.password });
    expect(status).toMatchObject({ enabled: true, updatedBy: OWNER.email });
    expect(await getServerConsoleStatus()).toEqual(status);
  });

  it("locks after repeated wrong passwords", async () => {
    // An address of its own: the lock lives in memory and would outlast this test.
    const context: Context = { ...browserContext(owner), client: { address: "203.0.113.99", userAgent: "vitest" } };
    const browser = createServerApi(context).settings;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectApiError(browser.setServerConsole({ enabled: true, password: `faux-${attempt}` }), "validation");
    }
    const locked = await expectApiError(browser.setServerConsole({ enabled: true, password: OWNER.password }), "forbidden");
    expect(locked.message).toContain("Trop de tentatives");
    expect((await getServerConsoleStatus()).enabled).toBe(false);
  });

  it("turns off without a password, even with a token, and journals both switches", async () => {
    await enableConsole();
    expect((await apiAs(owner).settings.setServerConsole({ enabled: false })).enabled).toBe(false);
    const events = await db().activityEvent.findMany({ where: { type: "settings.updated" }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.title)).toEqual(["Console du serveur activée", "Console du serveur désactivée"]);
    expect(events[0].description).toBe(`${OWNER.email} · 203.0.113.7`);
    expect(events[0].severity).toBe("warning");
  });

  it("cannot be flipped through the generic settings.update", async () => {
    await apiAs(owner).settings.update({ ...({ serverConsole: { enabled: true }, enabled: true } as object) });
    expect((await getServerConsoleStatus()).enabled).toBe(false);
    expect(() => authorize(systemContext({ ...owner, role: "admin" }), "settings.setServerConsole")).toThrow();
  });
});

// ─── terminal service ────────────────────────────────────────────────────────

interface Attempt {
  /** HTTP status of a refused handshake, or 101 when the WebSocket opened. */
  status: number;
  socket: WebSocket | null;
}

describe("terminal service", () => {
  let server: TerminalServer;
  let url: string;
  const logs: string[] = [];
  const opened: WebSocket[] = [];
  /** Text frames of each connection, in order. */
  const received = new WeakMap<WebSocket, string[]>();
  /** Everything each connection's terminal printed. */
  const printed = new WeakMap<WebSocket, string>();

  async function listen(options: { idleTimeoutMs?: number; recheckIntervalMs?: number } = {}): Promise<void> {
    server = createTerminalServer({
      cwd: process.cwd(),
      recheckIntervalMs: 100,
      log: (line) => logs.push(line),
      ...options,
    });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}/ws`;
  }

  /** Handshake the way it arrives behind NGINX and the Next.js rewrite. */
  function connect(headers: Record<string, string | undefined>, target = url): Promise<Attempt> {
    const sent: Record<string, string> = {
      "x-forwarded-host": "platform.test",
      "x-forwarded-for": "198.51.100.9, 203.0.113.7",
    };
    for (const [name, value] of Object.entries(headers)) if (value !== undefined) sent[name] = value;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(target, { headers: sent });
      // The first message can arrive before the caller listens: kept from the start.
      const texts: string[] = [];
      received.set(socket, texts);
      printed.set(socket, "");
      socket.on("message", (data: Buffer, isBinary: boolean) => {
        if (isBinary) printed.set(socket, printed.get(socket)! + data.toString("utf8"));
        else texts.push(data.toString("utf8"));
      });
      socket.on("open", () => {
        opened.push(socket);
        resolve({ status: 101, socket });
      });
      socket.on("unexpected-response", (_request, response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0, socket: null });
      });
      socket.on("error", (error) => {
        if (!/Unexpected server response/.test(error.message)) reject(error);
      });
    });
  }

  /** The `session` message every connection starts with. */
  async function hello(socket: WebSocket): Promise<{ id: string; resumed: boolean }> {
    const texts = received.get(socket)!;
    await waitUntil(() => texts.length > 0, "the session message");
    const message = JSON.parse(texts[0]) as { type: string; id: string; resumed: boolean };
    expect(message.type).toBe("session");
    return { id: message.id, resumed: message.resumed };
  }

  /** Asks the service to end the terminal, like "Fermer la session". */
  function endTerminal(socket: WebSocket): void {
    socket.send(JSON.stringify({ type: "close" }));
  }

  function closed(socket: WebSocket): Promise<number> {
    return new Promise((resolve) => socket.on("close", (code) => resolve(code)));
  }

  /** Types `command`, resolves once `pattern` shows up in what the terminal printed. */
  async function run(socket: WebSocket, command: string, pattern: RegExp): Promise<RegExpMatchArray> {
    let text = "";
    const listener = (data: Buffer, isBinary: boolean): void => {
      if (isBinary) text += data.toString("utf8");
    };
    socket.on("message", listener);
    socket.send(Buffer.from(`${command}\n`));
    try {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const match = text.match(pattern);
        if (match) return match;
        if (Date.now() > deadline) throw new Error(`"${pattern}" never showed up in:\n${text}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      socket.off("message", listener);
    }
  }

  async function waitUntil(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  const cookie = (token: string): string => `theme=dark; mr_session=${token}`;

  beforeEach(() => {
    logs.length = 0;
  });

  afterEach(async () => {
    for (const socket of opened.splice(0)) socket.terminate();
    await server.close();
  });

  it("serves nothing over plain HTTP but a liveness probe", async () => {
    await listen();
    const base = url.replace("ws://", "http://").replace("/ws", "");
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/ws`)).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it("refuses a handshake without a session, with a forged one or with an API token", async () => {
    await listen();
    await enableConsole();
    expect((await connect({ origin: ORIGIN })).status).toBe(401);
    expect((await connect({ origin: ORIGIN, cookie: cookie("A".repeat(43)) })).status).toBe(401);
    expect((await connect({ origin: ORIGIN, cookie: "mr_session=" })).status).toBe(401);

    const { secret } = await apiAs(owner).settings.createToken({ name: "Automate" });
    expect((await connect({ origin: ORIGIN, authorization: `Bearer ${secret}` })).status).toBe(401);
    expect(server.sessionCount()).toBe(0);
    expect(logs.filter((line) => line.startsWith("refused (401"))).toHaveLength(4);
    expect(logs[0]).toContain("from 203.0.113.7");
  });

  it("refuses every role but the owner", async () => {
    await listen();
    await enableConsole();
    for (const role of ["admin", "developer", "viewer"] as const) {
      const member = await createMember(owner, role);
      const token = await createSession(member.id, "vitest");
      expect((await connect({ origin: ORIGIN, cookie: cookie(token) })).status).toBe(403);
    }
    expect(server.sessionCount()).toBe(0);
  });

  it("refuses the owner from another origin, without an origin, and on another path", async () => {
    await listen();
    await enableConsole();
    const token = await createSession(owner.id, "vitest");
    expect((await connect({ origin: "https://evil.example", cookie: cookie(token) })).status).toBe(403);
    expect((await connect({ cookie: cookie(token) })).status).toBe(403);
    expect((await connect({ origin: ORIGIN, cookie: cookie(token) }, url.replace("/ws", "/shell"))).status).toBe(404);
    expect(server.sessionCount()).toBe(0);
  });

  it("is unreachable, even for the owner, until the switch is on", async () => {
    await listen();
    const token = await createSession(owner.id, "vitest");
    expect((await connect({ origin: ORIGIN, cookie: cookie(token) })).status).toBe(403);
    expect(logs.at(-1)).toContain("console disabled");
    expect(server.sessionCount()).toBe(0);
    expect(await db().activityEvent.count({ where: { type: "console.opened" } })).toBe(0);
  });

  describe.runIf(canOpenShells)("with a shell", () => {
    it("gives the owner an interactive terminal in the service's directory, and journals it", async () => {
      await listen();
      await enableConsole();
      const token = await createSession(owner.id, "vitest");
      const { status, socket } = await connect({ origin: ORIGIN, cookie: cookie(token) }, `${url}?cols=132&rows=43`);
      expect(status).toBe(101);
      expect((await hello(socket!)).resumed).toBe(false);
      expect(server.sessionCount()).toBe(1);

      const result = await run(socket!, 'ok=OK; echo "cwd$ok=$PWD size$ok=$(stty size) db$ok=[$DATABASE_URL]|"', /cwdOK=(\S+) sizeOK=(\d+ \d+) dbOK=\[(.*?)\]\|/);
      expect(result[1]).toBe(process.cwd());
      expect(result[2]).toBe("43 132");
      // The test database URL is in the environment of this process: the shell must not see it.
      expect(result[3]).toBe("");

      socket!.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      await run(socket!, 'echo "resized$ok=$(stty size)"', /resizedOK=30 100/);

      await waitUntil(async () => (await db().activityEvent.count({ where: { type: "console.opened" } })) === 1, "the opening in the journal");
      const openedEvent = await db().activityEvent.findFirstOrThrow({ where: { type: "console.opened" } });
      expect(openedEvent).toMatchObject({
        title: "Console du serveur ouverte",
        description: `${OWNER.email} · 203.0.113.7`,
        actor: OWNER.name,
        severity: "warning",
      });

      // "Fermer la session": the shell and what it started go with it, and it is journaled.
      await run(socket!, "sleep 86411 & sleep 0.2; echo started$ok", /startedOK/);
      const end = closed(socket!);
      endTerminal(socket!);
      expect(await end).toBe(CONSOLE_CLOSE.closed);
      await waitUntil(() => server.sessionCount() === 0, "the end of the session");
      await waitUntil(async () => (await db().activityEvent.count({ where: { type: "console.closed" } })) === 1, "the closing in the journal");
      const closedEvent = await db().activityEvent.findFirstOrThrow({ where: { type: "console.closed" } });
      expect(closedEvent.description).toContain(`${OWNER.email} · 203.0.113.7 · fermée par le propriétaire`);
      const { execFileSync } = await import("node:child_process");
      expect(() => execFileSync("pgrep", ["-f", "sleep 86411"])).toThrow();
    });

    it("keeps the terminal when the page is left, and gives it back with its latest output", async () => {
      await listen();
      await enableConsole();
      const token = await createSession(owner.id, "vitest");
      const headers = { origin: ORIGIN, cookie: cookie(token) };
      const first = await connect(headers);
      const { id } = await hello(first.socket!);
      await run(first.socket!, "kept=KEPT; cd /tmp; echo before$kept", /beforeKEPT/);

      // The tab leaves: the shell stays, detached.
      first.socket!.close();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(server.sessionCount()).toBe(1);
      expect(await db().activityEvent.count({ where: { type: "console.closed" } })).toBe(0);

      // Back on the page: the same shell, its state and its latest output.
      const back = await connect(headers, `${url}?session=${id}`);
      expect(await hello(back.socket!)).toEqual({ id, resumed: true });
      await waitUntil(() => printed.get(back.socket!)!.includes("beforeKEPT"), "the replayed output");
      await run(back.socket!, 'echo "where$kept=$PWD"', /whereKEPT=\/tmp/);
      expect(server.sessionCount()).toBe(1);

      // Without an id (a reload), the latest detached terminal is the one resumed.
      back.socket!.close();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const reload = await connect(headers);
      expect(await hello(reload.socket!)).toEqual({ id, resumed: true });

      // new=1 opens another one.
      const fresh = await connect(headers, `${url}?new=1`);
      expect((await hello(fresh.socket!)).resumed).toBe(false);
      expect(server.sessionCount()).toBe(2);
    });

    it("hands a terminal over to the tab that resumes it", async () => {
      await listen();
      await enableConsole();
      const token = await createSession(owner.id, "vitest");
      const headers = { origin: ORIGIN, cookie: cookie(token) };
      const first = await connect(headers);
      const { id } = await hello(first.socket!);
      const firstEnd = closed(first.socket!);

      const second = await connect(headers, `${url}?session=${id}`);
      expect(await hello(second.socket!)).toEqual({ id, resumed: true });
      expect(await firstEnd).toBe(CONSOLE_CLOSE.takenOver);
      await run(second.socket!, "echo still$((40+2))", /still42/);
      expect(server.sessionCount()).toBe(1);
    });

    it("never gives a terminal to someone else", async () => {
      await listen();
      await enableConsole();
      const token = await createSession(owner.id, "vitest");
      const first = await connect({ origin: ORIGIN, cookie: cookie(token) });
      const { id } = await hello(first.socket!);
      first.socket!.close();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Another owner account (promoted for the test) gets a terminal of its own.
      const other = await createMember(owner, "admin");
      await db().user.update({ where: { id: other.id }, data: { role: "owner" } });
      const otherToken = await createSession(other.id, "vitest");
      const attempt = await connect({ origin: ORIGIN, cookie: cookie(otherToken) }, `${url}?session=${id}`);
      const answer = await hello(attempt.socket!);
      expect(answer.resumed).toBe(false);
      expect(answer.id).not.toBe(id);
    });

    it("opens two terminals at most", async () => {
      await listen();
      await enableConsole();
      const token = await createSession(owner.id, "vitest");
      const headers = { origin: ORIGIN, cookie: cookie(token) };
      const first = await connect(headers);
      const second = await connect(headers);
      expect([first.status, second.status]).toEqual([101, 101]);

      const third = await connect(headers);
      expect(await closed(third.socket!)).toBe(CONSOLE_CLOSE.tooManySessions);
      expect(server.sessionCount()).toBe(2);

      // A tab that left still holds its slot; it is free again once the terminal is really gone.
      first.socket!.close();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(server.sessionCount()).toBe(2);
      const back = await connect(headers);
      expect((await hello(back.socket!)).resumed).toBe(true);
      endTerminal(back.socket!);
      await waitUntil(() => server.sessionCount() === 1, "the first session to end");
      expect((await connect(headers)).status).toBe(101);
      expect(server.sessionCount()).toBe(2);
    });

    it("closes a terminal nobody types in", async () => {
      await listen({ idleTimeoutMs: 400, recheckIntervalMs: 50 });
      await enableConsole();
      const token = await createSession(owner.id, "vitest");
      const { socket } = await connect({ origin: ORIGIN, cookie: cookie(token) });
      expect(await closed(socket!)).toBe(CONSOLE_CLOSE.idle);
      await waitUntil(() => server.sessionCount() === 0, "the end of the session");
      await waitUntil(async () => (await db().activityEvent.count({ where: { type: "console.closed" } })) === 1, "the journal");
      expect((await db().activityEvent.findFirstOrThrow({ where: { type: "console.closed" } })).description).toContain("inactivité");
    });

    it("closes the terminals when the switch goes off", async () => {
      await listen();
      await enableConsole();
      const token = await createSession(owner.id, "vitest");
      const { socket } = await connect({ origin: ORIGIN, cookie: cookie(token) });
      const end = closed(socket!);
      await apiAs(owner).settings.setServerConsole({ enabled: false });
      expect(await end).toBe(CONSOLE_CLOSE.disabled);
      expect((await connect({ origin: ORIGIN, cookie: cookie(token) })).status).toBe(403);
    });

    it("closes the terminal when the owner signs out", async () => {
      await listen();
      await enableConsole();
      const token = await createSession(owner.id, "vitest");
      const { socket } = await connect({ origin: ORIGIN, cookie: cookie(token) });
      const end = closed(socket!);
      await destroySession(token);
      expect(await end).toBe(CONSOLE_CLOSE.signedOut);
    });

    it("tells the browser when the shell exits by itself", async () => {
      await listen();
      await enableConsole();
      const token = await createSession(owner.id, "vitest");
      const { socket } = await connect({ origin: ORIGIN, cookie: cookie(token) });
      const messages = received.get(socket!)!;
      const end = closed(socket!);
      socket!.send(Buffer.from("exit 3\n"));
      expect(await end).toBe(CONSOLE_CLOSE.shellExited);
      expect(messages).toHaveLength(2);
      expect(JSON.parse(messages[0])).toMatchObject({ type: "session", resumed: false });
      expect(messages[1]).toBe(JSON.stringify({ type: "exit", code: 3 }));
    });

    it("ends every session when the service stops", async () => {
      await listen();
      await enableConsole();
      const token = await createSession(owner.id, "vitest");
      const { socket } = await connect({ origin: ORIGIN, cookie: cookie(token) });
      const end = closed(socket!);
      await server.close();
      expect(await end).toBe(CONSOLE_CLOSE.serverStopping);
      expect(server.sessionCount()).toBe(0);
    });
  });
});
