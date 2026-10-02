/**
 * Dockerfile generation for the plans of ./detect.ts (builder "nixpacks"
 * without a Dockerfile in the repository). Small official base images,
 * dependencies from the lock file, a non-root user at runtime.
 *
 * User-provided commands are always written in JSON (exec) form, so a line
 * break in a command cannot add an instruction to the Dockerfile.
 */

import { validation } from "../errors";
import type { BuildPlan } from "./detect";

export interface DockerfileOptions {
  /** Port the service listens on (service.port). */
  port: number;
  /** Overrides of the service configuration; "" means none. */
  buildCommand: string;
  startCommand: string;
  /**
   * Names of the NON-secret variables passed with --build-arg. They are
   * declared as ARG in the build stage only: build arguments stay visible in
   * the image history, which is why secrets are never among them.
   */
  buildArgs: readonly string[];
}

export interface GeneratedBuild {
  dockerfile: string;
  /** To use when the repository has no .dockerignore of its own. */
  dockerignore: string;
  /** One line for the build log. */
  description: string;
}

export const DEFAULT_DOCKERIGNORE = [".git", "node_modules", ".next", ".env*", ""].join("\n");

const ARG_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shell(command: string): string {
  return JSON.stringify(["/bin/sh", "-c", command]);
}

function argLines(names: readonly string[]): string[] {
  return names.filter((name) => ARG_NAME.test(name)).map((name) => `ARG ${name}`);
}

const NO_START =
  "Aucune commande de démarrage n’a été trouvée pour ce dépôt. Ajoutez un script « start » au package.json, renseignez la commande de démarrage du service ou ajoutez un Dockerfile.";
const NO_PYTHON_START =
  "Aucun point d’entrée Python n’a été trouvé (main.py, app.py, server.py ou manage.py). Renseignez la commande de démarrage du service ou ajoutez un Dockerfile.";

function nodeDockerfile(plan: BuildPlan, options: DockerfileOptions): GeneratedBuild {
  const { port } = options;
  const base = `node:${plan.nodeMajor}-alpine`;
  const next = plan.kind === "nextjs";
  const manager = plan.packageManager;
  const buildCommand = options.buildCommand.trim();
  const startCommand = options.startCommand.trim();

  let setup: string | null = null;
  let install: string;
  if (manager === "pnpm") {
    // corepack left the Node.js distribution with version 25.
    setup = plan.nodeMajor < 25 ? "RUN corepack enable" : "RUN npm install -g pnpm";
    install = "pnpm install --frozen-lockfile";
  } else if (manager === "yarn") {
    setup = plan.yarnBerry && plan.nodeMajor < 25 ? "RUN corepack enable" : null;
    install = plan.yarnBerry ? "yarn install --immutable" : "yarn install --frozen-lockfile";
  } else if (manager === "bun") {
    setup = "RUN npm install -g bun";
    install = "bun install --frozen-lockfile";
  } else {
    install = plan.lockFile ? "npm ci" : "npm install";
  }

  let build: string | null = null;
  if (buildCommand !== "") build = `RUN ${shell(buildCommand)}`;
  else if (plan.hasBuildScript) build = `RUN ${manager} run build`;
  // `next start` needs a build even when the repository declares no build script.
  else if (next) build = "RUN node_modules/.bin/next build";

  let start: string;
  if (startCommand !== "") start = shell(startCommand);
  // npm runs the script whatever manager installed the dependencies: the runtime stage needs no other tool.
  else if (plan.hasStartScript) start = JSON.stringify(["npm", "run", "start"]);
  else if (next) start = JSON.stringify(["node_modules/.bin/next", "start", "-p", String(port), "-H", "0.0.0.0"]);
  else if (plan.entryFile !== null) start = JSON.stringify(["node", plan.entryFile]);
  else throw validation(NO_START);

  const lines: string[] = [`FROM ${base} AS build`, "WORKDIR /app"];
  if (next) lines.push("ENV NEXT_TELEMETRY_DISABLED=1");
  if (setup) lines.push(setup);
  if (plan.hasDependencies) {
    if (manager !== "npm" || plan.hasInstallScripts || plan.lockFile === null) {
      // Install scripts and the other managers (workspaces, patches, .yarn) may need the whole tree.
      lines.push("COPY . .", `RUN ${install}`);
    } else {
      // Manifests first: the dependency layer is reused while they do not change.
      lines.push(`COPY package.json ${plan.lockFile} .npmrc* ./`, `RUN ${install}`, "COPY . .");
    }
  } else {
    lines.push("COPY . .");
  }
  // After the install on purpose: NODE_ENV=production would skip the devDependencies a build needs.
  lines.push(...argLines(options.buildArgs), "ENV NODE_ENV=production");
  if (build) lines.push(build);
  if (manager === "npm" && plan.hasDependencies && build) lines.push("RUN npm prune --omit=dev");

  lines.push(
    "",
    `FROM ${base}`,
    "WORKDIR /app",
    `ENV NODE_ENV=production PORT=${port} HOSTNAME=0.0.0.0${next ? " NEXT_TELEMETRY_DISABLED=1" : ""}`,
    "COPY --from=build --chown=node:node /app ./",
    "USER node",
    `EXPOSE ${port}`,
    `CMD ${start}`,
    "",
  );
  return {
    dockerfile: lines.join("\n"),
    dockerignore: DEFAULT_DOCKERIGNORE,
    description: `${next ? "Next.js" : "Node.js"} on ${base} with ${manager}`,
  };
}

function staticDockerfile(options: DockerfileOptions): GeneratedBuild {
  const { port } = options;
  const config = [
    "server {",
    `  listen ${port};`,
    "  server_name _;",
    "  root /usr/share/nginx/html;",
    "  index index.html;",
    "  location / { try_files $uri $uri/ /index.html; }",
    "}",
  ];
  const quoted = config.map((line) => `'${line}'`).join(" ");
  const lines = [
    "FROM nginx:alpine",
    // The stock image runs as root and writes its pid under /run: moved so the unprivileged user can start it.
    `RUN printf '%s\\n' ${quoted} > /etc/nginx/conf.d/default.conf \\`,
    " && sed -i -e '/^user /d' -e 's#^pid .*#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \\",
    " && rm -rf /usr/share/nginx/html/* \\",
    " && chown -R nginx:nginx /var/cache/nginx /etc/nginx/conf.d",
    "COPY --chown=nginx:nginx . /usr/share/nginx/html",
    "USER nginx",
    `EXPOSE ${port}`,
    `CMD ${options.startCommand.trim() !== "" ? shell(options.startCommand.trim()) : JSON.stringify(["nginx", "-g", "daemon off;"])}`,
    "",
  ];
  return {
    dockerfile: lines.join("\n"),
    dockerignore: DEFAULT_DOCKERIGNORE,
    description: `static site on nginx:alpine listening on port ${port}`,
  };
}

function pythonDockerfile(plan: BuildPlan, options: DockerfileOptions): GeneratedBuild {
  const { port } = options;
  const base = "python:3.12-slim";
  const buildCommand = options.buildCommand.trim();
  const startCommand = options.startCommand.trim();

  let start: string;
  if (startCommand !== "") start = shell(startCommand);
  else if (plan.python.django) start = JSON.stringify(["python", "manage.py", "runserver", `0.0.0.0:${port}`]);
  else if (plan.entryFile !== null) start = JSON.stringify(["python", plan.entryFile]);
  else throw validation(NO_PYTHON_START);

  const lines: string[] = [
    `FROM ${base} AS build`,
    "WORKDIR /app",
    "RUN python -m venv /opt/venv",
    "ENV PATH=/opt/venv/bin:$PATH PIP_DISABLE_PIP_VERSION_CHECK=1",
  ];
  if (plan.python.requirements) {
    lines.push("COPY requirements.txt ./", "RUN pip install --no-cache-dir -r requirements.txt", "COPY . .");
  } else {
    lines.push("COPY . .", "RUN pip install --no-cache-dir .");
  }
  lines.push(...argLines(options.buildArgs));
  if (buildCommand !== "") lines.push(`RUN ${shell(buildCommand)}`);
  lines.push(
    "",
    `FROM ${base}`,
    "RUN useradd --create-home --uid 10001 app",
    "WORKDIR /app",
    `ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PORT=${port}`,
    "COPY --from=build /opt/venv /opt/venv",
    "COPY --from=build --chown=app:app /app ./",
    "USER app",
    `EXPOSE ${port}`,
    `CMD ${start}`,
    "",
  );
  return {
    dockerfile: lines.join("\n"),
    dockerignore: [DEFAULT_DOCKERIGNORE.trimEnd(), "__pycache__", ".venv", ""].join("\n"),
    description: `Python on ${base}`,
  };
}

/** Rejects with a French ApiError when the plan cannot be started (no start command to be found). */
export function generateDockerfile(plan: BuildPlan, options: DockerfileOptions): GeneratedBuild {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw validation("Le port du service n’est pas valide.", "config.port");
  }
  switch (plan.kind) {
    case "nextjs":
    case "node":
      return nodeDockerfile(plan, options);
    case "static":
      return staticDockerfile(options);
    case "python":
      return pythonDockerfile(plan, options);
    case "dockerfile":
      throw new Error("generateDockerfile called for a repository that has its own Dockerfile");
  }
}
