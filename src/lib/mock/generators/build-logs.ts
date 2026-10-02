/**
 * Deployment log scripts.
 *
 * A script is the full list of lines a deployment prints, each tagged with the
 * integer progress (0–100) at which it appears. It is a pure function of the
 * deployment id (seeded PRNG) and of its service, so logs never need to be
 * stored: a line is visible as soon as `deployment.progress >= line.p`.
 */

import type {
  DeploymentCommit,
  DeploymentTrigger,
  LogLevel,
  LogStream,
  ServiceConfig,
  ServiceSource,
  ServiceVolume,
} from "@/lib/types";

import { bootLines, type Entry } from "./boot";
import { recipeFor, stackOf } from "./build-recipes";
import type { Family } from "./family";
import { hexString, randFloat, randInt, seededRng, type Rng } from "./prng";

export interface ScriptLine {
  p: number;
  level: LogLevel;
  stream: LogStream;
  /**
   * May contain `{pgts}` / `{redists}` (line timestamp), `{buildTime}` and
   * `{totalTime}` (durations), resolved when the line is served.
   */
  message: string;
}

export interface ScriptContext {
  deploymentId: string;
  trigger: DeploymentTrigger;
  commit: DeploymentCommit | null;
  /** Full reference being deployed ("redis:7-alpine", "registry…/app:3f9a2c1"). */
  image: string;
  serviceName: string;
  serviceSlug: string;
  containerName: string;
  region: string;
  source: ServiceSource;
  config: ServiceConfig;
  volume: ServiceVolume | null;
  /** Framework (or language) of the repository, GitHub services only. */
  stack: string | null;
  family: Family;
  variableCount: number;
  /** Public hostnames routed to the service. */
  hostnames: string[];
}

export interface Failure {
  lines: ScriptLine[];
  /** French reason stored in `deployment.error`. */
  error: string;
}

export interface DeploymentScript {
  /** Happy path, ordered by `p`. */
  lines: ScriptLine[];
  /** Replaces everything after FAIL_POINT when the build breaks. */
  buildFailure: Failure;
  /** Replaces everything after HEALTHCHECK_FAIL_POINT when the container never gets healthy. */
  healthFailure: Failure;
}

/** Progress at which a broken build stops. */
export const FAIL_POINT = 60;
export const HEALTHCHECK_FAIL_POINT = 90;

/** Progress ranges of each section (building = 5–75, deploying = 75–99). */
const RANGE = {
  queue: [1, 4],
  fetch: [5, 11],
  plan: [12, 15],
  install: [16, 43],
  buildStart: [44, 59],
  buildEnd: [62, 69],
  export: [70, 74],
  deployStart: [76, 90],
  deployEnd: [92, 99],
} as const;

function toLine(entry: Entry, p: number, stream: LogStream): ScriptLine {
  return typeof entry === "string"
    ? { p, level: "info", stream, message: entry }
    : { p, level: entry[0], stream, message: entry[1] };
}

/** Spreads `entries` evenly over the integer range. */
function section(
  stream: LogStream,
  range: readonly [number, number],
  entries: Entry[],
): ScriptLine[] {
  const [from, to] = range;
  const span = to - from + 1;
  return entries.map((entry, index) =>
    toLine(entry, from + Math.min(span - 1, Math.floor((index * span) / entries.length)), stream),
  );
}

function at(stream: LogStream, p: number, entries: Entry[]): ScriptLine[] {
  return entries.map((entry) => toLine(entry, p, stream));
}

function seconds(rng: Rng, min: number, max: number): string {
  return randFloat(rng, min, max).toFixed(1);
}

function nixpacksPlan(rows: Array<[string, string]>): Entry[] {
  const width = 62;
  const title = " Nixpacks v1.29.1 ";
  const left = Math.floor((width - title.length) / 2);
  return [
    `╔${"═".repeat(left)}${title}${"═".repeat(width - title.length - left)}╗`,
    ...rows.map(
      ([label, value]) => `║ ${label.padEnd(8)} │ ${value.slice(0, width - 13).padEnd(width - 13)} ║`,
    ),
    `╚${"═".repeat(width)}╝`,
  ];
}

interface BuildPart {
  lines: ScriptLine[];
  failure: Failure;
}

function githubBuild(ctx: ScriptContext, rng: Rng): BuildPart {
  const source = ctx.source.type === "github" ? ctx.source : null;
  const recipe = recipeFor(stackOf(ctx.stack), ctx.serviceSlug, rng);
  const build = ctx.config.buildCommand || recipe.build;
  const start = ctx.config.startCommand || recipe.start;
  const repo = source?.repo ?? ctx.serviceSlug;
  const branch = ctx.commit?.branch ?? source?.branch ?? "main";
  const shortSha = (ctx.commit?.sha ?? hexString(rng, 40)).slice(0, 7);
  const objects = randInt(rng, 900, 4200);
  const compressed = Math.round(objects * 0.74);
  const nixHash = hexString(rng, 12);
  const dockerfile = ctx.config.builder === "dockerfile";
  const stage = dockerfile ? "builder" : "stage-0";

  const fetch: Entry[] = [
    `===> Fetching source from github.com/${repo} (branch ${branch})`,
    "Cloning into '/workspace'...",
    `remote: Enumerating objects: ${objects}, done.`,
    `remote: Compressing objects: 100% (${compressed}/${compressed}), done.`,
    `Receiving objects: 100% (${objects}/${objects}), ${seconds(rng, 1.2, 9.4)} MiB | ${seconds(rng, 11, 24)} MiB/s, done.`,
    `HEAD is now at ${shortSha} ${ctx.commit?.message ?? "deploy"}`,
  ];
  if (source && source.rootDirectory !== "/") {
    fetch.push(`Using root directory ${source.rootDirectory}`);
  }

  const plan: Entry[] = dockerfile
    ? [
        `Found Dockerfile at ${source?.rootDirectory === "/" || !source ? "" : source.rootDirectory}/Dockerfile`,
        "Using the Dockerfile builder",
      ]
    : nixpacksPlan([
        ["setup", recipe.setup],
        ["install", recipe.install],
        ["build", build],
        ["start", start],
      ]);

  const baseImage = dockerfile
    ? "docker.io/library/node:22-alpine"
    : "ghcr.io/railwayapp/nixpacks:ubuntu-1745885067";
  const install: Entry[] = [
    ["debug", "#1 [internal] load build definition from Dockerfile"],
    ["debug", `#2 [internal] load metadata for ${baseImage}`],
    `#3 [${stage} 1/6] FROM ${baseImage}`,
    ["debug", "#3 CACHED"],
    ...(dockerfile
      ? []
      : ([
          `#4 [${stage} 2/6] RUN nix-env -if .nixpacks/nixpkgs-${nixHash}.nix && nix-collect-garbage -d`,
          ["debug", "#4 CACHED"],
        ] satisfies Entry[])),
    `#5 [${stage} 3/6] COPY . /app/.`,
    `#6 [${stage} 4/6] RUN ${recipe.install}`,
    ...recipe.installOutput,
    ["debug", `#6 DONE ${seconds(rng, 6, 21)}s`],
  ];

  const buildStart: Entry[] = [`#7 [${stage} 5/6] RUN ${build}`, ...recipe.buildStart];
  const buildEnd: Entry[] = [...recipe.buildEnd, ["debug", `#7 DONE ${seconds(rng, 12, 44)}s`]];
  const exportImage: Entry[] = [
    `#8 [${stage} 6/6] COPY . /app`,
    "#9 exporting to image",
    ["debug", `#9 exporting layers ${seconds(rng, 2, 6)}s done`],
    ["debug", `#9 writing image sha256:${hexString(rng, 64)} done`],
    `#9 naming to ${ctx.image} done`,
    `Pushing ${ctx.image}`,
  ];

  const failed = `process "/bin/bash -ol pipefail -c ${build}" did not complete successfully: exit code: 1`;

  return {
    lines: [
      ...section("build", RANGE.fetch, fetch),
      ...section("build", RANGE.plan, plan),
      ...section("build", RANGE.install, install),
      ...section("build", RANGE.buildStart, buildStart),
      ...section("build", RANGE.buildEnd, buildEnd),
      ...section("build", RANGE.export, exportImage),
      ...at("build", 75, [["success", "Build completed in {buildTime}"]]),
    ],
    failure: {
      lines: at("build", FAIL_POINT, [
        ...recipe.failure.lines,
        ["error", `#7 ERROR: ${failed}`],
        ["error", `ERROR: failed to solve: ${failed}`],
        ["error", "Build failed after {buildTime}"],
      ]),
      error: recipe.failure.error,
    },
  };
}

/** Registry host of an image reference, or null for Docker Hub. */
function registryOf(image: string): string | null {
  const first = image.split("/")[0];
  return image.includes("/") && /[.:]/.test(first) ? first : null;
}

function pullBuild(ctx: ScriptContext, rng: Rng): BuildPart {
  const [reference, tag = "latest"] = splitImage(ctx.image);
  const registry = registryOf(reference);
  const path = registry
    ? reference.slice(registry.length + 1)
    : reference.includes("/")
      ? reference
      : `library/${reference}`;
  const layers = Array.from({ length: randInt(rng, 5, 8) }, () => hexString(rng, 12));
  const half = Math.ceil(layers.length / 2);

  const first: Entry[] = [
    `===> Pulling image ${reference}:${tag}`,
    `${tag}: Pulling from ${path}`,
    ...layers.map((layer): Entry => ["debug", `${layer}: Pulling fs layer`]),
    ...layers.slice(0, 3).map((layer): Entry => {
      const total = randFloat(rng, 8, 96);
      return `${layer}: Downloading [==========>          ]  ${(total * randFloat(rng, 0.2, 0.7)).toFixed(1)}MB/${total.toFixed(1)}MB`;
    }),
    ...layers.slice(0, half).map((layer) => `${layer}: Pull complete`),
  ];
  const second: Entry[] = [
    ...layers.slice(half).map((layer) => `${layer}: Pull complete`),
    `Digest: sha256:${hexString(rng, 64)}`,
    `Status: Downloaded newer image for ${reference}:${tag}`,
  ];

  const stalled = layers[half] ?? layers[0];
  return {
    lines: [
      ...section("build", [RANGE.fetch[0], RANGE.buildStart[1]], first),
      ...section("build", [RANGE.buildEnd[0], RANGE.export[1]], second),
      ...at("build", 75, [["success", "Image ready in {buildTime}"]]),
    ],
    failure: {
      lines: at("build", FAIL_POINT, [
        ["warn", `${stalled}: Retrying in 5 seconds`],
        ["warn", `${stalled}: Retrying in 1 second`],
        registry
          ? ["error", `Error response from daemon: Get "https://${registry}/v2/": net/http: TLS handshake timeout`]
          : ["error", "toomanyrequests: You have reached your pull rate limit. You may increase the limit by authenticating and upgrading: https://www.docker.com/increase-rate-limit"],
        ["error", "Image pull failed after {buildTime}"],
      ]),
      error: registry
        ? `Échec du téléchargement de l’image : le registre ${registry} ne répond pas`
        : "Échec du téléchargement de l’image : limite de requêtes Docker Hub atteinte (429)",
    },
  };
}

/** "ghcr.io/acme/api:1.2" → ["ghcr.io/acme/api", "1.2"] (a registry port is not a tag). */
export function splitImage(image: string): [string, string | undefined] {
  const colon = image.lastIndexOf(":");
  if (colon === -1 || image.indexOf("/", colon) !== -1) return [image, undefined];
  return [image.slice(0, colon), image.slice(colon + 1)];
}

function deployPart(ctx: ScriptContext, rng: Rng): { lines: ScriptLine[]; failure: Failure } {
  const { config } = ctx;
  const postgres = ctx.source.type === "postgres";
  const healthPath = config.healthcheckPath;
  const version =
    ctx.source.type === "postgres"
      ? ctx.source.version
      : ctx.source.type === "docker"
        ? ctx.source.tag
        : "";

  const start: Entry[] = [
    `===> Deploying ${ctx.serviceName} (${config.replicas} replica${config.replicas > 1 ? "s" : ""}, ${ctx.region})`,
    `Creating container ${ctx.containerName} from ${ctx.image}`,
  ];
  if (ctx.volume) start.push(`Mounting volume ${ctx.volume.name} at ${ctx.volume.mountPath}`);
  start.push(`Injecting ${ctx.variableCount} environment variables`, "Starting container");
  start.push(
    ...bootLines(
      {
        family: ctx.family,
        framework: ctx.stack,
        slug: ctx.serviceSlug,
        port: config.port,
        version,
        startCommand: config.startCommand,
        firstBoot: ctx.trigger === "initial",
      },
      ctx.source.type,
    ),
  );

  const end: Entry[] = [];
  if (postgres) {
    start.push("Healthcheck: pg_isready -U postgres");
    end.push(["success", "Healthcheck passed: accepting connections"]);
  } else if (healthPath) {
    start.push(`Healthcheck GET ${healthPath}: waiting for a 2xx response`);
    end.push(["success", `Healthcheck passed: 200 OK in ${randInt(rng, 18, 140)} ms`]);
  } else {
    start.push(`Waiting for port ${config.port} to accept connections`);
    end.push(`Port ${config.port} is accepting connections`);
  }
  for (const hostname of ctx.hostnames.slice(0, 2)) {
    end.push(`Updated NGINX upstream for ${hostname}`);
  }
  end.push("Routing traffic to the new deployment");
  if (ctx.trigger !== "initial") end.push("Draining previous deployment");

  const probe = `Healthcheck GET ${healthPath || "/health"}`;
  return {
    lines: [
      ...section("deploy", RANGE.deployStart, start),
      ...section("deploy", RANGE.deployEnd, end),
      ...at("deploy", 100, [["success", "Deployment successful, live in {totalTime}"]]),
    ],
    failure: {
      lines: at("deploy", HEALTHCHECK_FAIL_POINT, [
        ["warn", `${probe}: attempt 1/3 returned 503 Service Unavailable`],
        ["warn", `${probe}: attempt 2/3 returned 503 Service Unavailable`],
        ["error", `${probe}: attempt 3/3 failed (connection refused)`],
        ["error", "Healthcheck failed after 3 attempts"],
        "Stopping container",
        "Previous deployment keeps serving traffic",
        ["error", "Deployment failed: the service never became healthy"],
      ]),
      error: `Le healthcheck ${healthPath || "/health"} a échoué après 3 tentatives`,
    },
  };
}

export function buildScript(ctx: ScriptContext): DeploymentScript {
  const rng = seededRng("script", ctx.deploymentId);
  const queue = section("build", RANGE.queue, [
    `Deployment ${ctx.deploymentId} queued (trigger: ${ctx.trigger})`,
    `Builder assigned: builder-${ctx.region}-${randInt(rng, 1, 4)}`,
  ]);
  const build = ctx.source.type === "github" ? githubBuild(ctx, rng) : pullBuild(ctx, rng);
  const deploy = deployPart(ctx, rng);

  return {
    lines: [...queue, ...build.lines, ...deploy.lines],
    buildFailure: build.failure,
    healthFailure: deploy.failure,
  };
}

export function cancelLine(progress: number, superseded: boolean): ScriptLine {
  return {
    p: progress,
    level: "warn",
    stream: progress >= 75 ? "deploy" : "build",
    message: superseded
      ? "Deployment superseded by a newer deployment"
      : "Deployment cancelled by user",
  };
}
