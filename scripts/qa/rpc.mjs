#!/usr/bin/env node
// RPC client for testing the backend.
//
// CLI
//   node scripts/qa/rpc.mjs <method> ['<json args array>'] [--jar <file>] [--base <url>] [--token <bearer>]
//   node scripts/qa/rpc.mjs auth.login '[{"email":"a@b.mg","password":"…"}]' --jar /tmp/jar.json
//   node scripts/qa/rpc.mjs settings.get --jar /tmp/jar.json
//
//   Prints the JSON result; on an error response prints the error object and exits 1.
//   The base URL defaults to the dev server recorded in .next/dev/lock
//   (override with --base or QA_BASE_URL). Cookies are kept in the jar file.
//
// Module
//   import { rpc, call } from "./rpc.mjs";
//   const session = await rpc("auth.getSession", [], { jar: "/tmp/jar.json" });
//   const { status, body } = await call("projects.list", [], { token: "mr_live_…" });
//
//   options: { jar?, base?, token?, headers? } - `headers` are merged over the
//   defaults; a null value removes a default header (e.g. {"X-Mini-Railway": null}).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function resolveBaseUrl() {
  if (process.env.QA_BASE_URL) return process.env.QA_BASE_URL;
  try {
    const lock = JSON.parse(readFileSync(resolve(PROJECT_ROOT, ".next/dev/lock"), "utf8"));
    if (typeof lock.appUrl === "string") return lock.appUrl;
  } catch {
    // No dev server lock: fall through to the default port.
  }
  return "http://localhost:3000";
}

function readJar(file) {
  if (!file || !existsSync(file)) return {};
  try {
    const cookies = JSON.parse(readFileSync(file, "utf8"));
    return typeof cookies === "object" && cookies !== null ? cookies : {};
  } catch {
    return {};
  }
}

function updateJar(file, cookies, response) {
  if (!file) return;
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0) return;
  for (const line of setCookies) {
    const [pair, ...attributes] = line.split(";");
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
    if (expired || value === "") delete cookies[name];
    else cookies[name] = value;
  }
  writeFileSync(file, JSON.stringify(cookies, null, 2), { mode: 0o600 });
}

/** Cookie header of a jar file ("" when empty), for requests made outside this helper. */
export function cookieHeader(jar) {
  return Object.entries(readJar(jar))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/** Low-level call: never throws on an error response. Returns { status, body, response }. */
export async function call(method, args = [], options = {}) {
  const base = options.base ?? resolveBaseUrl();
  const cookies = readJar(options.jar);
  const headers = { "Content-Type": "application/json", "X-Mini-Railway": "1" };
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (cookie) headers.Cookie = cookie;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
    }
    if (value !== null) headers[name] = value;
  }

  const response = await fetch(new URL("/api/rpc", base), {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify({ method, args }),
  });
  updateJar(options.jar, cookies, response);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: the status is all there is.
  }
  return { status: response.status, body, response };
}

/** Resolves with the result; rejects with an Error carrying `status` and `error`. */
export async function rpc(method, args = [], options = {}) {
  const { status, body } = await call(method, args, options);
  if (status >= 200 && status < 300) return body?.result;
  const detail = body?.error ?? { code: "unknown", message: `HTTP ${status}` };
  const error = new Error(`${method}: ${detail.message}`);
  error.status = status;
  error.error = detail;
  throw error;
}

async function main(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--jar" || arg === "--base" || arg === "--token") {
      options[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      positional.push(arg);
    }
  }
  const [method, rawArgs] = positional;
  if (!method) {
    console.error(
      "Usage: node scripts/qa/rpc.mjs <method> ['<json args array>'] [--jar <file>] [--base <url>] [--token <bearer>]",
    );
    process.exit(2);
  }
  let args = [];
  if (rawArgs !== undefined) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      console.error("The arguments must be a JSON array.");
      process.exit(2);
    }
    if (!Array.isArray(args)) args = [args];
  }
  try {
    const result = await rpc(method, args, options);
    console.log(JSON.stringify(result === undefined ? null : result, null, 2));
  } catch (error) {
    console.error(JSON.stringify(error.error ?? { code: "unknown", message: String(error) }, null, 2));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
