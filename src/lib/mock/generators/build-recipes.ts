/**
 * Per-stack build output for GitHub services: what the package manager and
 * the framework compiler print, and what a broken build looks like.
 */

import type { Entry } from "./boot";
import { pick, randFloat, randInt, type Rng } from "./prng";

export type Stack =
  | "next"
  | "nest"
  | "node"
  | "astro"
  | "laravel"
  | "django"
  | "fastapi"
  | "go";

const STACKS: Record<string, Stack> = {
  "Next.js": "next",
  NestJS: "nest",
  Astro: "astro",
  Laravel: "laravel",
  PHP: "laravel",
  Django: "django",
  FastAPI: "fastapi",
  Python: "fastapi",
  Gin: "go",
  Go: "go",
};

/** @param stack Framework, or language when the repository has no framework. */
export function stackOf(stack: string | null): Stack {
  return (stack && STACKS[stack]) || "node";
}

export interface Recipe {
  /** Nix packages of the setup phase. */
  setup: string;
  install: string;
  build: string;
  start: string;
  installOutput: Entry[];
  /** Printed before the point where a broken build stops. */
  buildStart: Entry[];
  /** Printed after it, when the build goes through. */
  buildEnd: Entry[];
  failure: {
    lines: Entry[];
    /** Short French reason stored on the deployment. */
    error: string;
  };
}

function seconds(rng: Rng, min: number, max: number): string {
  return randFloat(rng, min, max).toFixed(1);
}

function npmInstall(rng: Rng): Entry[] {
  const packages = randInt(rng, 380, 760);
  return [
    ["warn", "npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it."],
    ["warn", "npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported"],
    `added ${packages} packages, and audited ${packages + 1} packages in ${randInt(rng, 9, 24)}s`,
    `${randInt(rng, 110, 190)} packages are looking for funding`,
    "  run `npm fund` for details",
    "found 0 vulnerabilities",
  ];
}

function typeScriptFailure(rng: Rng): { file: string; line: number; code: string } {
  return pick(rng, [
    {
      file: "src/features/invoices/reminders.ts",
      line: 42,
      code: "await sendReminder(member?.email, invoice);",
    },
    {
      file: "src/lib/payments/mvola-client.ts",
      line: 87,
      code: "return confirmPayment(transaction.reference, amount);",
    },
    {
      file: "src/app/(dashboard)/evenements/actions.ts",
      line: 31,
      code: "const seats = registerAttendee(event.id, session.user.id);",
    },
  ]);
}

function nextRecipe(slug: string, rng: Rng): Recipe {
  const pages = randInt(rng, 14, 38);
  const failure = typeScriptFailure(rng);
  return {
    setup: "nodejs_22, npm-10_x",
    install: "npm ci",
    build: "npm run build",
    start: "npm run start",
    installOutput: npmInstall(rng),
    buildStart: [
      `> ${slug}@0.1.0 build`,
      "> next build",
      "   ▲ Next.js 15.4.6",
      "   - Environments: .env.production",
      "   Creating an optimized production build ...",
      ["success", ` ✓ Compiled successfully in ${seconds(rng, 14, 31)}s`],
      "   Linting and checking validity of types ...",
    ],
    buildEnd: [
      "   Collecting page data ...",
      ["success", ` ✓ Generating static pages (${pages}/${pages})`],
      "   Finalizing page optimization ...",
      "   Collecting build traces ...",
      "Route (app)                                 Size  First Load JS",
      "┌ ○ /                                    5.21 kB         118 kB",
      "├ ○ /_not-found                            977 B         102 kB",
      "├ ƒ /api/health                            142 B         101 kB",
      "├ ƒ /connexion                           2.94 kB         121 kB",
      "└ ƒ /tableau-de-bord                     8.36 kB         134 kB",
      "+ First Load JS shared by all             101 kB",
      "○  (Static)   prerendered as static content",
      "ƒ  (Dynamic)  server-rendered on demand",
    ],
    failure: {
      lines: [
        ["error", "Failed to compile."],
        ["error", `./${failure.file}:${failure.line}:27`],
        ["error", "Type error: Argument of type 'string | undefined' is not assignable to parameter of type 'string'."],
        ["error", "  Type 'undefined' is not assignable to type 'string'."],
        `  ${failure.line - 1} |   // …`,
        `> ${failure.line} |     ${failure.code}`,
        "     |                           ^",
        ["error", "Next.js build worker exited with code: 1 and signal: null"],
      ],
      error: `Erreur de typage TypeScript dans ${failure.file} (ligne ${failure.line})`,
    },
  };
}

function nestRecipe(slug: string, rng: Rng): Recipe {
  const packages = randInt(rng, 620, 940);
  const files = randInt(rng, 96, 210);
  return {
    setup: "nodejs_22, pnpm-9_x",
    install: "pnpm install --frozen-lockfile",
    build: "pnpm run build",
    start: "pnpm run start:prod",
    installOutput: [
      "Lockfile is up to date, resolution step is skipped",
      `Packages: +${packages}`,
      `Progress: resolved ${packages}, reused ${packages - 14}, downloaded 14, added ${packages}, done`,
      "dependencies:",
      "+ @nestjs/core 10.4.15",
      "+ @prisma/client 6.3.1",
      `Done in ${seconds(rng, 6, 15)}s`,
    ],
    buildStart: [
      `> ${slug}@1.4.0 build /app`,
      "> nest build -b swc --type-check",
      ">  TSC  Initializing type checker...",
      ">  SWC  Running...",
    ],
    buildEnd: [
      ">  TSC  Found 0 issues.",
      ["success", `Successfully compiled: ${files} files with swc (${randInt(rng, 84, 190)}.${randInt(rng, 10, 99)}ms)`],
    ],
    failure: {
      lines: [
        ["error", "src/orders/orders.service.ts:118:31 - error TS2345: Argument of type 'string | null' is not assignable to parameter of type 'string'."],
        "118     await this.payments.confirm(order.paymentReference);",
        "                                  ~~~~~~~~~~~~~~~~~~~~~~",
        ["error", ">  TSC  Found 1 issue(s)."],
        ["error", " ELIFECYCLE  Command failed with exit code 1."],
      ],
      error: "Erreur TypeScript TS2345 dans src/orders/orders.service.ts (ligne 118)",
    },
  };
}

function nodeRecipe(slug: string, rng: Rng): Recipe {
  const failure = typeScriptFailure(rng);
  return {
    setup: "nodejs_22, npm-10_x",
    install: "npm ci",
    build: "npm run build",
    start: "npm run start",
    installOutput: npmInstall(rng),
    buildStart: [`> ${slug}@1.0.0 build`, "> tsc -p tsconfig.build.json"],
    buildEnd: [["success", `Compiled ${randInt(rng, 40, 160)} files to dist/`]],
    failure: {
      lines: [
        ["error", `${failure.file}(${failure.line},27): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.`],
        ["error", "npm error Lifecycle script `build` failed with error:"],
        ["error", "npm error code 2"],
      ],
      error: `Erreur TypeScript TS2345 dans ${failure.file} (ligne ${failure.line})`,
    },
  };
}

function astroRecipe(slug: string, rng: Rng): Recipe {
  const pages = randInt(rng, 9, 26);
  return {
    setup: "nodejs_22, npm-10_x",
    install: "npm ci",
    build: "npm run build",
    start: "npm run preview -- --host 0.0.0.0",
    installOutput: npmInstall(rng),
    buildStart: [
      `> ${slug}@1.0.0 build`,
      "> astro build",
      "[content] Syncing content",
      "[content] Synced content",
      "[types] Generated 148ms",
      '[build] output: "static"',
      "[build] directory: /app/dist/",
      "[build] Collecting build info...",
      "[build] Building static entrypoints...",
    ],
    buildEnd: [
      `[vite] ✓ built in ${seconds(rng, 1.6, 3.4)}s`,
      " generating static routes ",
      "▶ src/pages/index.astro",
      "  └─ /index.html (+14ms)",
      "▶ src/pages/blog/[slug].astro",
      "  ├─ /blog/auto-hebergement-docker/index.html (+9ms)",
      "  └─ /blog/postgresql-en-production/index.html (+7ms)",
      `[build] ${pages} page(s) built in ${seconds(rng, 2.8, 5.2)}s`,
      ["success", "[build] Complete!"],
    ],
    failure: {
      lines: [
        ["error", "[ERROR] [vite] x Build failed in 1.24s"],
        ["error", 'Could not resolve "../components/Hero.astro" from "src/pages/index.astro"'],
        "  Stack trace:",
        "    at getRollupError (file:///app/node_modules/rollup/dist/es/shared/parseAst.js:397:41)",
        "    at ModuleLoader.handleInvalidResolvedId (file:///app/node_modules/rollup/dist/es/shared/node-entry.js:21442:24)",
      ],
      error: "Import introuvable : ../components/Hero.astro (src/pages/index.astro)",
    },
  };
}

function laravelRecipe(rng: Rng): Recipe {
  return {
    setup: "php83, php83Packages.composer, nodejs_22",
    install: "composer install --no-dev --optimize-autoloader && npm ci",
    build: "npm run build && php artisan optimize",
    start: "php artisan migrate --force && php-fpm",
    installOutput: [
      "Installing dependencies from lock file",
      `Package operations: ${randInt(rng, 72, 118)} installs, 0 updates, 0 removals`,
      "  - Installing laravel/framework (v11.31.0): Extracting archive",
      "  - Installing livewire/livewire (v3.5.12): Extracting archive",
      "Generating optimized autoload files",
      "> Illuminate\\Foundation\\ComposerScripts::postAutoloadDump",
      `added ${randInt(rng, 120, 190)} packages, and audited ${randInt(rng, 191, 240)} packages in ${randInt(rng, 4, 9)}s`,
    ],
    buildStart: ["> build", "> vite build", "vite v5.4.11 building for production...", "transforming..."],
    buildEnd: [
      `✓ ${randInt(rng, 48, 96)} modules transformed.`,
      "public/build/manifest.json             0.27 kB │ gzip:  0.15 kB",
      "public/build/assets/app-BkT9x2Qe.css  48.12 kB │ gzip:  8.04 kB",
      "public/build/assets/app-C3fWq8Lm.js   92.40 kB │ gzip: 31.87 kB",
      `✓ built in ${seconds(rng, 1.4, 3.1)}s`,
      "   INFO  Caching framework bootstrap, configuration, and metadata.",
      "  config ........................................ 14.52ms DONE",
      "  routes ........................................ 21.03ms DONE",
      ["success", "  views ......................................... 88.71ms DONE"],
    ],
    failure: {
      lines: [
        ["error", "x Build failed in 812ms"],
        ["error", "error during build:"],
        ["error", '[vite]: Rollup failed to resolve import "./components/MemberSearch.vue" from "/app/resources/js/app.js".'],
        "This is most likely unintended because it can break your application at runtime.",
      ],
      error: "Import introuvable : ./components/MemberSearch.vue (resources/js/app.js)",
    },
  };
}

function pythonRecipe(stack: "django" | "fastapi", rng: Rng): Recipe {
  const django = stack === "django";
  return {
    setup: "python312, gcc",
    install: "pip install -r requirements.txt",
    build: django ? "python manage.py collectstatic --noinput" : "python -m compileall -q app",
    start: django
      ? "gunicorn config.wsgi --bind 0.0.0.0:$PORT"
      : "uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    installOutput: [
      django
        ? "Collecting Django==5.1.4 (from -r requirements.txt (line 1))"
        : "Collecting fastapi==0.115.6 (from -r requirements.txt (line 1))",
      django
        ? "  Downloading Django-5.1.4-py3-none-any.whl (8.3 MB)"
        : "  Downloading fastapi-0.115.6-py3-none-any.whl (94 kB)",
      "Collecting psycopg[binary]==3.2.3 (from -r requirements.txt (line 4))",
      "  Downloading psycopg-3.2.3-py3-none-any.whl (197 kB)",
      `Installing collected packages: ${django ? "sqlparse, asgiref, psycopg-binary, psycopg, gunicorn, Django, djangorestframework" : "sniffio, idna, anyio, starlette, pydantic, psycopg, uvicorn, fastapi"}`,
      `Successfully installed ${randInt(rng, 18, 34)} packages`,
    ],
    buildStart: [],
    buildEnd: [
      django
        ? ["success", `${randInt(rng, 140, 220)} static files copied to '/app/staticfiles', ${randInt(rng, 300, 460)} post-processed.`]
        : ["success", "Compiled application modules"],
    ],
    failure: django
      ? {
          lines: [
            "Traceback (most recent call last):",
            '  File "/app/manage.py", line 22, in <module>',
            "    main()",
            '  File "/opt/venv/lib/python3.12/site-packages/django/core/management/__init__.py", line 442, in execute_from_command_line',
            "    utility.execute()",
            '  File "/app/lignes/urls.py", line 6, in <module>',
            "    from .views import LigneViewSet, ArretViewSet",
            ["error", "ImportError: cannot import name 'ArretViewSet' from 'lignes.views' (/app/lignes/views.py)"],
          ],
          error: "ImportError : « ArretViewSet » est introuvable dans lignes.views",
        }
      : {
          lines: [
            '  File "app/routers/alertes.py", line 58',
            "    return {'zone': zone, 'debut': debut",
            "           ^",
            ["error", "SyntaxError: '{' was never closed"],
          ],
          error: "SyntaxError dans app/routers/alertes.py (ligne 58)",
        },
  };
}

function goRecipe(slug: string): Recipe {
  return {
    setup: "go_1_23",
    install: "go mod download",
    build: "go build -o out ./cmd/server",
    start: "./out",
    installOutput: [
      "go: downloading github.com/go-chi/chi/v5 v5.1.0",
      "go: downloading github.com/jackc/pgx/v5 v5.7.1",
      "go: downloading github.com/rs/zerolog v1.33.0",
      "go: downloading golang.org/x/crypto v0.29.0",
    ],
    buildStart: [],
    buildEnd: [["success", "Compiled ./cmd/server to out (14.2 MB)"]],
    failure: {
      lines: [
        `# github.com/${slug}/internal/mailer`,
        ["error", "internal/mailer/send.go:58:14: undefined: template.MustParse"],
        ["error", "internal/mailer/send.go:71:3: declared and not used: retries"],
      ],
      error: "Erreur de compilation Go : internal/mailer/send.go:58 (undefined: template.MustParse)",
    },
  };
}

export function recipeFor(stack: Stack, slug: string, rng: Rng): Recipe {
  switch (stack) {
    case "next":
      return nextRecipe(slug, rng);
    case "nest":
      return nestRecipe(slug, rng);
    case "astro":
      return astroRecipe(slug, rng);
    case "laravel":
      return laravelRecipe(rng);
    case "django":
    case "fastapi":
      return pythonRecipe(stack, rng);
    case "go":
      return goRecipe(slug);
    default:
      return nodeRecipe(slug, rng);
  }
}
