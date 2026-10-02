/**
 * Project detection for repositories without a Dockerfile. Only reads a few
 * files of the build directory: nothing from the repository is ever executed
 * on the host, and symbolic links are not followed (a link named package.json
 * could point at a file of the platform).
 */

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { validation } from "../errors";

export type ProjectKind = "dockerfile" | "nextjs" | "node" | "static" | "python";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface BuildPlan {
  kind: ProjectKind;
  packageManager: PackageManager;
  /** Lock file found at the root, null when dependencies are not locked. */
  lockFile: string | null;
  /** Yarn 2+ (a .yarnrc.yml exists): its install flags differ from Yarn 1. */
  yarnBerry: boolean;
  nodeMajor: number;
  hasDependencies: boolean;
  /** preinstall / install / postinstall / prepare: the install then needs the whole source tree. */
  hasInstallScripts: boolean;
  hasBuildScript: boolean;
  hasStartScript: boolean;
  /** File started with `node` (or `python`) when there is no start script. */
  entryFile: string | null;
  python: { requirements: boolean; pyproject: boolean; django: boolean };
  hasDockerignore: boolean;
  /** Human-readable lines for the build log. */
  reasons: string[];
}

export const DEFAULT_NODE_MAJOR = 22;
const MIN_NODE_MAJOR = 16;
const MAX_NODE_MAJOR = 26;
const MAX_MANIFEST_BYTES = 1024 * 1024;

const LOCK_FILES: ReadonlyArray<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];
const NODE_ENTRIES = ["server.js", "index.js", "app.js", "main.js"];
const PYTHON_ENTRIES = ["main.py", "app.py", "server.py"];
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];
const SAFE_RELATIVE_FILE = /^(?:\.\/)?[A-Za-z0-9_@+-][A-Za-z0-9_@+./-]*$/;

async function isRegularFile(directory: string, name: string): Promise<boolean> {
  try {
    return (await lstat(path.join(directory, name))).isFile();
  } catch {
    return false;
  }
}

async function readSmallFile(directory: string, name: string): Promise<string | null> {
  try {
    const file = path.join(directory, name);
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) return null;
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** "v20.11.1", "20", ">=18", "^20.0.0", "20.x" -> a supported major, null otherwise. */
export function parseNodeMajor(text: string): number | null {
  const match = /(>=?|\^|~|=|v)?\s*(\d{1,2})(?:\.|\s|$|x)/i.exec(text.trim());
  if (!match) return null;
  const major = Number(match[2]);
  if (!Number.isInteger(major) || major < MIN_NODE_MAJOR || major > MAX_NODE_MAJOR) return null;
  // An open lower bound is satisfied by the default version too.
  return match[1]?.startsWith(">") ? Math.max(major, DEFAULT_NODE_MAJOR) : major;
}

export function unsupportedProject(rootDirectory: string): Error {
  return validation(
    `Aucun type de projet reconnu dans le répertoire « ${rootDirectory} » du dépôt : ni Dockerfile, ni package.json (Node.js, Next.js), ni requirements.txt ou pyproject.toml (Python), ni index.html (site statique). Ajoutez un Dockerfile au dépôt ou corrigez le répertoire racine du service.`,
  );
}

/**
 * Looks at the files of `directory` and decides how to build it. Rejects with
 * a French ApiError when nothing is recognised. `rootDirectory` is the path
 * shown in messages ("/" or "/apps/web").
 */
export async function detectProject(directory: string, rootDirectory = "/"): Promise<BuildPlan> {
  const plan: BuildPlan = {
    kind: "dockerfile",
    packageManager: "npm",
    lockFile: null,
    yarnBerry: false,
    nodeMajor: DEFAULT_NODE_MAJOR,
    hasDependencies: false,
    hasInstallScripts: false,
    hasBuildScript: false,
    hasStartScript: false,
    entryFile: null,
    python: { requirements: false, pyproject: false, django: false },
    hasDockerignore: await isRegularFile(directory, ".dockerignore"),
    reasons: [],
  };

  if (await isRegularFile(directory, "Dockerfile")) {
    plan.reasons.push("Found a Dockerfile: the repository's own Dockerfile is used");
    return plan;
  }

  const manifestText = await readSmallFile(directory, "package.json");
  if (manifestText !== null) {
    let manifest: Record<string, unknown>;
    try {
      manifest = record(JSON.parse(manifestText));
    } catch {
      throw validation("Le fichier package.json du dépôt n’est pas un JSON valide.");
    }
    const dependencies = record(manifest.dependencies);
    const devDependencies = record(manifest.devDependencies);
    const scripts = record(manifest.scripts);
    const isScript = (name: string): boolean => typeof scripts[name] === "string" && scripts[name].trim() !== "";

    plan.kind = "next" in dependencies || "next" in devDependencies ? "nextjs" : "node";
    plan.reasons.push(
      plan.kind === "nextjs"
        ? "Found package.json with the \"next\" dependency: Next.js application"
        : "Found package.json: Node.js application",
    );
    plan.hasDependencies =
      Object.keys(dependencies).length + Object.keys(devDependencies).length + Object.keys(record(manifest.optionalDependencies)).length > 0;
    plan.hasInstallScripts = INSTALL_SCRIPTS.some(isScript);
    plan.hasBuildScript = isScript("build");
    plan.hasStartScript = isScript("start");

    for (const [file, manager] of LOCK_FILES) {
      if (await isRegularFile(directory, file)) {
        plan.lockFile = file;
        plan.packageManager = manager;
        break;
      }
    }
    plan.yarnBerry = plan.packageManager === "yarn" && (await isRegularFile(directory, ".yarnrc.yml"));
    plan.reasons.push(
      plan.lockFile
        ? `Package manager: ${plan.packageManager} (${plan.lockFile})`
        : "Package manager: npm (no lock file found)",
    );

    const nvmrc = await readSmallFile(directory, ".nvmrc");
    const engines = record(manifest.engines).node;
    const fromNvmrc = nvmrc !== null ? parseNodeMajor(nvmrc) : null;
    const fromEngines = typeof engines === "string" ? parseNodeMajor(engines) : null;
    if (fromNvmrc !== null) {
      plan.nodeMajor = fromNvmrc;
      plan.reasons.push(`Node.js ${fromNvmrc} (.nvmrc)`);
    } else if (fromEngines !== null) {
      plan.nodeMajor = fromEngines;
      plan.reasons.push(`Node.js ${fromEngines} (engines.node in package.json)`);
    } else {
      plan.reasons.push(`Node.js ${DEFAULT_NODE_MAJOR} (default)`);
    }

    const main = typeof manifest.main === "string" ? manifest.main.trim() : "";
    const candidates = main !== "" && SAFE_RELATIVE_FILE.test(main) && !main.includes("..") ? [main, ...NODE_ENTRIES] : NODE_ENTRIES;
    for (const candidate of candidates) {
      if (await isRegularFile(directory, candidate)) {
        plan.entryFile = candidate;
        break;
      }
    }
    plan.reasons.push(
      `Scripts: build ${plan.hasBuildScript ? "found" : "not found"}, start ${plan.hasStartScript ? "found" : "not found"}`,
    );
    return plan;
  }

  const requirements = await readSmallFile(directory, "requirements.txt");
  const pyproject = await isRegularFile(directory, "pyproject.toml");
  if (requirements !== null || pyproject) {
    plan.kind = "python";
    plan.python = {
      requirements: requirements !== null,
      pyproject,
      django: await isRegularFile(directory, "manage.py"),
    };
    plan.reasons.push(`Found ${requirements !== null ? "requirements.txt" : "pyproject.toml"}: Python application`);
    if (plan.python.django) {
      plan.entryFile = "manage.py";
    } else {
      for (const candidate of PYTHON_ENTRIES) {
        if (await isRegularFile(directory, candidate)) {
          plan.entryFile = candidate;
          break;
        }
      }
    }
    plan.reasons.push(plan.entryFile ? `Entry point: ${plan.entryFile}` : "No entry point found (main.py, app.py, server.py, manage.py)");
    return plan;
  }

  if (await isRegularFile(directory, "index.html")) {
    plan.kind = "static";
    plan.reasons.push("Found index.html without package.json: static site served by nginx");
    return plan;
  }

  throw unsupportedProject(rootDirectory);
}
