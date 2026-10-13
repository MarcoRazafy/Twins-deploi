/**
 * Terminal service of TwinsDeploi (`npm run terminal`): the WebSocket end of
 * the "Console" page, a shell on the host for the owner.
 *
 * Listens on the loopback only. The rules are in src/server/terminal/server.ts;
 * the systemd unit (scripts/server/install.sh) runs it as the platform account
 * with NoNewPrivileges, so nothing started from a terminal can gain rights
 * through sudo or a setuid binary.
 */

import { db } from "../server/db";
import { env } from "../server/env";
import { createTerminalServer } from "../server/terminal/server";

const SCOPE = "terminal";

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} [${SCOPE}] ${message.replace(/\s*\n\s*/g, " | ")}\n`);
}

if (process.getuid?.() === 0) {
  log("refusing to run as root: the console must use the platform account");
  process.exit(1);
}

const port = env.terminalPort;
const server = createTerminalServer({ cwd: process.cwd(), log });

server.http.on("error", (error) => {
  log(`cannot listen on 127.0.0.1:${port}: ${error.message}`);
  process.exit(1);
});
server.http.listen(port, "127.0.0.1", () => {
  log(`listening on 127.0.0.1:${port}, shells start in ${process.cwd()}`);
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log(`${signal} received: closing ${server.sessionCount()} session(s)`);
  await server.close();
  await db().$disconnect().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
