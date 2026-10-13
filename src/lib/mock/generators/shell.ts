/**
 * The few command lines the simulated database console understands. The real
 * backend runs them in the container of an application service (see
 * src/server/databases/console.ts); here the answers are plausible text,
 * enough to exercise the interface.
 */

export interface ShellContext {
  /** Name of the application service the command "runs" in. */
  serviceName: string;
  /** Name of the database of the console. */
  database: string;
}

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const WORKDIR = "/app";

function ok(stdout: string): ShellResult {
  return { exitCode: 0, stdout: stdout === "" ? "" : `${stdout}\n`, stderr: "" };
}

function fail(exitCode: number, stderr: string): ShellResult {
  return { exitCode, stdout: "", stderr: `${stderr}\n` };
}

function unquote(text: string): string {
  const value = text.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

function npx(args: string, context: ShellContext): ShellResult {
  if (/^prisma\s+migrate\s+(deploy|status)\b/.test(args)) {
    return ok(
      [
        "Prisma schema loaded from prisma/schema.prisma",
        `Datasource "db": PostgreSQL database "${context.database}"`,
        "",
        "No pending migrations to apply.",
      ].join("\n"),
    );
  }
  if (/^prisma\s+(-v|--version)\b/.test(args)) return ok("prisma : 7.10.0");
  return fail(1, `npx: le simulateur ne connaît pas « ${args.split(/\s+/)[0] ?? ""} »`);
}

function npm(args: string, context: ShellContext): ShellResult {
  if (/^(-v|--version)$/.test(args)) return ok("11.6.2");
  const script = /^run(?:\s+(\S+))?/.exec(args);
  if (!script) return fail(1, "npm: le simulateur ne comprend que « npm run <script> »");
  if (!script[1]) return ok("Scripts available via `npm run`:\n  build\n  start\n  db:migrate");
  return ok(`\n> ${context.serviceName.toLowerCase()}@1.0.0 ${script[1]}\n\nTerminé (simulation).`);
}

/** Runs one command line; an unknown command answers like a shell would (127). */
export function runShell(line: string, context: ShellContext): ShellResult {
  const [name = "", ...rest] = line.trim().split(/\s+/);
  const args = line.trim().slice(name.length).trim();
  switch (name) {
    case "whoami":
      return ok("node");
    case "pwd":
      return ok(WORKDIR);
    case "echo":
      return ok(unquote(args));
    case "ls":
      return ok(rest.some((arg) => !arg.startsWith("-")) ? "" : "node_modules\npackage.json\nprisma\nsrc");
    case "node":
      return /^(-v|--version)$/.test(args) ? ok("v22.20.0") : fail(1, "node: le simulateur ne comprend que « node -v »");
    case "npm":
      return npm(args, context);
    case "npx":
      return npx(args, context);
    case "help":
      return ok("Commandes du simulateur : whoami, pwd, echo, ls, node -v, npm run <script>, npx prisma migrate deploy");
    default:
      return fail(127, `sh: ${name}: not found`);
  }
}
