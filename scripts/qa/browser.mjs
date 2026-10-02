// Shared Playwright helpers for visual / interaction QA.
//
// Uses the system Chrome through playwright-core (no browser download).
//
//   import { withPage } from "./browser.mjs";
//   await withPage(async (page, { goto, settle, shot }) => {
//     await goto("/dashboard");
//     await page.getByRole("button", { name: "Nouveau projet" }).click();
//     await shot("/tmp/out.png");
//   }, { width: 1440, height: 900 });
//
// Console errors, page errors and failed requests are printed when the
// callback finishes, so runtime problems are never silently missed.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * `next dev` records its URL in .next/dev/lock, so the helpers always target
 * the dev server that is actually running (whatever port it picked).
 * Override with QA_BASE_URL, e.g. to test a `next start` production server.
 */
function resolveBaseUrl() {
  if (process.env.QA_BASE_URL) return process.env.QA_BASE_URL;
  try {
    const lock = JSON.parse(
      readFileSync(resolve(PROJECT_ROOT, ".next/dev/lock"), "utf8"),
    );
    if (typeof lock.appUrl === "string") return lock.appUrl;
  } catch {
    // No dev server lock: fall through to the default port.
  }
  return "http://localhost:3000";
}

export const BASE_URL = resolveBaseUrl();

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "No Chrome/Chromium binary found. Set CHROME_PATH to a browser executable.",
    );
  }
  return found;
}

/** Messages that are noise rather than app problems. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/,
  /\[HMR\]/,
  /\[Fast Refresh\]/,
  /webpack-hmr|turbopack-hmr/,
];

/**
 * @param {(page: import("playwright-core").Page, helpers: {
 *   goto: (path: string) => Promise<void>,
 *   settle: (extraMs?: number) => Promise<void>,
 *   shot: (file: string, options?: { fullPage?: boolean }) => Promise<void>,
 * }) => Promise<void>} callback
 * @param {{ width?: number, height?: number, mobile?: boolean, reducedMotion?: boolean, quiet?: boolean }} [options]
 * @returns {Promise<{ problems: string[] }>}
 */
export async function withPage(callback, options = {}) {
  const mobile = options.mobile ?? false;
  const width = options.width ?? (mobile ? 390 : 1440);
  const height = options.height ?? (mobile ? 844 : 900);

  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--disable-dev-shm-usage", "--hide-scrollbars", "--mute-audio"],
  });

  const problems = [];
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: mobile,
      hasTouch: mobile,
      locale: "fr-FR",
      timezoneId: "Indian/Antananarivo",
      reducedMotion: options.reducedMotion ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);

    page.on("console", (message) => {
      const type = message.type();
      if (type !== "error" && type !== "warning") return;
      const text = message.text();
      if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
      problems.push(`console.${type}: ${text}`);
    });
    page.on("pageerror", (error) => {
      problems.push(`pageerror: ${error.message}`);
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "";
      if (failure.includes("ERR_ABORTED")) return;
      problems.push(`requestfailed: ${request.url()} ${failure}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        problems.push(`http ${response.status()}: ${response.url()}`);
      }
    });

    /** Waits until skeletons are gone and the UI has stopped moving. */
    const settle = async (extraMs = 500) => {
      try {
        await page.waitForFunction(
          () => document.querySelectorAll('[data-slot="skeleton"]').length === 0,
          undefined,
          { timeout: 8_000 },
        );
      } catch {
        problems.push("settle: skeletons still visible after 8s");
      }
      await page.waitForTimeout(extraMs);
    };

    const goto = async (path) => {
      const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await settle();
    };

    const shot = async (file, shotOptions = {}) => {
      await page.screenshot({ path: file, fullPage: shotOptions.fullPage ?? false });
      if (!options.quiet) console.log(`screenshot: ${file}`);
    };

    await callback(page, { goto, settle, shot });
    await context.close();
  } finally {
    await browser.close();
  }

  if (!options.quiet) {
    if (problems.length === 0) {
      console.log("console: clean (no errors, warnings or failed requests)");
    } else {
      console.log(`problems (${problems.length}):`);
      for (const problem of [...new Set(problems)]) console.log(`  - ${problem}`);
    }
  }
  return { problems };
}
