import { parseNumber } from "./validation";

export interface NginxPreviewInput {
  baseDomain: string;
  clientMaxBodySizeMb: string;
  proxyReadTimeoutSec: string;
  gzip: boolean;
  http2: boolean;
  forceHttps: boolean;
}

function shown(raw: string): string {
  const value = parseNumber(raw);
  return Number.isFinite(value) ? String(value) : "?";
}

/** The server block generated for a service, from the (possibly unsaved) form values. */
export function buildNginxSnippet(input: NginxPreviewInput): string {
  const host = input.baseDomain.trim() || "up.exemple.mg";
  const lines = [
    "# Généré par TwinsDeploi pour chaque domaine",
    "server {",
    "  listen 80;",
    "  listen 443 ssl;",
  ];
  if (input.http2) lines.push("  http2 on;");
  lines.push(
    `  server_name mon-service.${host};`,
    "",
    `  client_max_body_size ${shown(input.clientMaxBodySizeMb)}m;`,
    `  proxy_read_timeout ${shown(input.proxyReadTimeoutSec)}s;`,
  );
  if (input.forceHttps) {
    lines.push("", "  if ($scheme = http) {", "    return 301 https://$host$request_uri;", "  }");
  }
  if (input.gzip) {
    lines.push("", "  gzip on;", "  gzip_types text/plain text/css application/json application/javascript;");
  }
  lines.push(
    "",
    "  location / {",
    "    proxy_pass http://127.0.0.1:3000;",
    "    proxy_set_header Host $host;",
    "    proxy_set_header X-Forwarded-Proto $scheme;",
    "  }",
    "}",
  );
  return lines.join("\n");
}
