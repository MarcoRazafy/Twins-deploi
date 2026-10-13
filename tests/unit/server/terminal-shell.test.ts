import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openShell, shellEnvironment, type Shell } from "@/server/terminal/shell";

/**
 * The real thing: python3, a pseudo-terminal and the login shell of the
 * account running the tests. The bridge refuses root, so does this file.
 */
const runnable = process.getuid?.() !== 0;

interface Harness {
  shell: Shell;
  output: () => string;
  exit: Promise<number | null>;
  waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<RegExpMatchArray>;
}

let directory: string | null = null;
let current: Harness | null = null;

function start(marker: string, cols = 90, rows = 20): Harness {
  directory = realpathSync(mkdtempSync(path.join(tmpdir(), "mr-terminal-")));
  let text = "";
  let resolveExit: (code: number | null) => void = () => {};
  const exit = new Promise<number | null>((resolve) => {
    resolveExit = resolve;
  });
  const shell = openShell({
    cwd: directory,
    cols,
    rows,
    marker,
    onData: (chunk) => {
      text += chunk.toString("utf8");
    },
    onExit: resolveExit,
  });
  const waitFor = async (pattern: RegExp, timeoutMs = 10_000): Promise<RegExpMatchArray> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = text.match(pattern);
      if (match) return match;
      if (Date.now() > deadline) throw new Error(`"${pattern}" never showed up in:\n${text}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  current = { shell, output: () => text, exit, waitFor };
  return current;
}

/** Pids of the processes whose command line contains `needle`. */
function pidsOf(needle: string): string[] {
  try {
    return execFileSync("pgrep", ["-f", needle], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

afterEach(async () => {
  if (current) {
    current.shell.close();
    await current.exit;
    current = null;
  }
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
});

describe("shellEnvironment", () => {
  it("is built from scratch: nothing of the platform's environment reaches the shell", () => {
    const environment = shellEnvironment({ DATABASE_URL: "postgres://secret", MINI_RAILWAY_SECRET_KEY: "k", LANG: "fr_FR.UTF-8" });
    expect(Object.keys(environment).sort()).toEqual(
      ["COLORTERM", "HOME", "LANG", "LOGNAME", "PATH", "SHELL", "TERM", "USER"].sort(),
    );
    expect(environment.TERM).toBe("xterm-256color");
    expect(environment.LANG).toBe("fr_FR.UTF-8");
    expect(environment.PATH.split(":")[0]).toBe(path.join(environment.HOME, ".local", "bin"));
  });
});

describe.runIf(runnable)("openShell", () => {
  it("is a real terminal: starts in the given directory, with the given size, and resizes", async () => {
    const { shell, waitFor } = start("unit1");
    // "$ok" keeps the patterns from matching the echo of the typed line.
    shell.write(Buffer.from('ok=OK; echo "cwd$ok=$PWD tty$ok=$(test -t 0 && echo yes) size$ok=$(stty size)|"\n'));
    const first = await waitFor(/cwdOK=(\S+) ttyOK=yes sizeOK=(\d+) (\d+)\|/);
    expect(first[1]).toBe(directory);
    expect([first[2], first[3]]).toEqual(["20", "90"]);

    shell.resize(132, 43);
    await new Promise((resolve) => setTimeout(resolve, 200));
    shell.write(Buffer.from('echo "resized$ok=$(stty size)"\n'));
    await waitFor(/resizedOK=43 132/);
  });

  it("does not inherit the environment of the service, and carries the session marker", async () => {
    process.env.MR_TERMINAL_TEST_SECRET = "leak";
    try {
      const { shell, waitFor } = start("unit2");
      shell.write(Buffer.from('ok=OK; echo "secret$ok=[${MR_TERMINAL_TEST_SECRET}] marker=[$MINI_RAILWAY_CONSOLE] term=[$TERM]"\n'));
      await waitFor(/secretOK=\[\] marker=\[unit2\] term=\[xterm-256color\]/);
    } finally {
      delete process.env.MR_TERMINAL_TEST_SECRET;
    }
  });

  it("reports the exit status of the shell", async () => {
    const { shell, exit } = start("unit3");
    shell.write(Buffer.from("exit 7\n"));
    expect(await exit).toBe(7);
  });

  it("leaves no process behind when the session is closed, not even detached ones", async () => {
    const { shell, exit, waitFor } = start("unit4");
    // A background job, a job that left the session, and one that ignores SIGHUP.
    shell.write(
      Buffer.from(
        "sleep 86401 & (setsid sleep 86402 >/dev/null 2>&1 &) ; nohup sleep 86403 >/dev/null 2>&1 & sleep 0.3; ok=OK; echo started$ok\n",
      ),
    );
    await waitFor(/startedOK/);
    expect(pidsOf("sleep 8640[123]")).toHaveLength(3);

    shell.close();
    await exit;
    expect(pidsOf("sleep 8640[123]")).toEqual([]);
  });
});
