/**
 * Runtime log lines (`docker logs --timestamps`) -> public LogLine.
 */

import type { LogLevel, LogLine } from "@/lib/types";

import type { RawLogLine } from "./containers";

const TIMESTAMPED = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)) ?(.*)$/;
const ERROR_HINT = /\b(error|fatal|panic|exception|traceback|critical)\b|\[(emerg|alert|crit|error)\]/i;
const WARN_HINT = /\bwarn(ing)?\b|\[warn\]|\bdeprecated\b/i;
const DEBUG_HINT = /\bdebug\b|\[debug\]/i;
/** Access-log style: `"GET /path HTTP/1.1" 502`. */
const HTTP_STATUS = /" (\d{3}) /;
const MAX_MESSAGE_LENGTH = 8000;

/** Applications do not tag their lines: the level is guessed from the text. */
export function inferLevel(message: string): LogLevel {
  const status = HTTP_STATUS.exec(message);
  if (status) {
    const code = Number(status[1]);
    return code >= 500 ? "error" : code >= 400 ? "warn" : "info";
  }
  if (ERROR_HINT.test(message)) return "error";
  if (WARN_HINT.test(message)) return "warn";
  if (DEBUG_HINT.test(message)) return "debug";
  return "info";
}

/**
 * Returns a mapper for the lines of one container. Ids are
 * "<container id>:<docker timestamp>[:n]": stable across calls, so a line seen
 * both in the history and in the live stream has the same id.
 */
export function createRuntimeLineMapper(containerId: string): (raw: RawLogLine) => LogLine {
  let lastStamp = "";
  let repeats = 0;
  return (raw) => {
    const match = TIMESTAMPED.exec(raw.line);
    const stamp = match ? match[1] : "";
    const body = match ? match[2] : raw.line;
    // Docker prints nanoseconds; Date keeps milliseconds.
    const parsed = stamp ? new Date(stamp.replace(/(\.\d{3})\d+/, "$1")) : new Date();
    const ts = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    const key = stamp || String(ts.getTime());
    repeats = key === lastStamp ? repeats + 1 : 0;
    lastStamp = key;
    const message = body.length > MAX_MESSAGE_LENGTH ? `${body.slice(0, MAX_MESSAGE_LENGTH)}…` : body;
    return {
      id: `${containerId}:${key}${repeats > 0 ? `:${repeats}` : ""}`,
      ts: ts.toISOString(),
      level: inferLevel(message),
      stream: "runtime",
      message,
    };
  };
}
