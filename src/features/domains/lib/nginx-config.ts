import { slugify } from "@/lib/format";
import type { Domain, PlatformSettings } from "@/lib/types";

const GZIP_TYPES =
  "text/plain text/css text/xml application/json application/javascript application/xml image/svg+xml";

export interface NginxConfigInput {
  domain: Pick<Domain, "hostname" | "targetPort" | "forceHttps" | "ssl">;
  serviceName: string;
  settings: PlatformSettings["nginx"];
}

/**
 * The server blocks the platform will write for a domain once the NGINX phase
 * lands. The UI only previews them: nothing here touches a real server.
 */
export function buildNginxConfig({ domain, serviceName, settings }: NginxConfigInput): string {
  const { hostname, targetPort, forceHttps, ssl } = domain;
  const upstream = hostname.replace(/[^a-z0-9]+/g, "_");
  const bodySize = settings.clientMaxBodySizeMb > 0 ? `${settings.clientMaxBodySizeMb}m` : "0";
  const certificates = `/etc/letsencrypt/live/${hostname}`;

  const proxyLocation = [
    "    location / {",
    `        proxy_pass http://${upstream};`,
    "        proxy_http_version 1.1;",
    "        proxy_set_header Host $host;",
    "        proxy_set_header X-Real-IP $remote_addr;",
    "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "        proxy_set_header X-Forwarded-Proto $scheme;",
    "        proxy_set_header Upgrade $http_upgrade;",
    '        proxy_set_header Connection "upgrade";',
    `        proxy_read_timeout ${settings.proxyReadTimeoutSec}s;`,
    "    }",
  ];

  const lines = [
    "# Généré par TwinsDeploi : ne modifiez pas ce fichier à la main.",
    `# Service ${serviceName} · domaine ${hostname} · port ${targetPort}`,
    `upstream ${upstream} {`,
    `    server ${slugify(serviceName)}.railway.internal:${targetPort};`,
    "}",
    "",
    "server {",
    "    listen 80;",
    "    listen [::]:80;",
    `    server_name ${hostname};`,
    "",
    "    # Validation du certificat (Let’s Encrypt)",
    "    location /.well-known/acme-challenge/ {",
    "        root /var/www/acme;",
    "    }",
    "",
  ];

  if (forceHttps) {
    lines.push("    location / {", "        return 301 https://$host$request_uri;", "    }");
  } else {
    lines.push(`    client_max_body_size ${bodySize};`, "", ...proxyLocation);
  }
  lines.push("}", "", "server {", "    listen 443 ssl;", "    listen [::]:443 ssl;");
  if (settings.http2) lines.push("    http2 on;");
  lines.push(`    server_name ${hostname};`, "");

  if (ssl.status !== "issued") {
    lines.push("    # Le certificat est émis après la validation DNS : ce bloc s’active à ce moment.");
  }
  lines.push(
    `    ssl_certificate     ${certificates}/fullchain.pem;`,
    `    ssl_certificate_key ${certificates}/privkey.pem;`,
    "    ssl_protocols       TLSv1.2 TLSv1.3;",
  );
  if (forceHttps) {
    lines.push('    add_header Strict-Transport-Security "max-age=31536000" always;');
  }
  lines.push("", `    client_max_body_size ${bodySize};`);
  if (settings.gzip) {
    lines.push("", "    gzip on;", "    gzip_min_length 1024;", `    gzip_types ${GZIP_TYPES};`);
  }
  lines.push("", ...proxyLocation, "}");

  return lines.join("\n");
}
