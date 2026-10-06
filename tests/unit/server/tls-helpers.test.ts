/**
 * The privileged helpers mini-railway-proxy (--tls) and mini-railway-cert run
 * here as a normal user in a sandbox (MINI_RAILWAY_TEST_ROOT), with a fake
 * certbot that writes a self-signed certificate. Needs python3 and openssl.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { certificateUsable } from "@/server/domains/tls";

const BIN = path.resolve(__dirname, "../../../scripts/server/bin");
const PROXY = path.join(BIN, "mini-railway-proxy");
const CERT = path.join(BIN, "mini-railway-cert");

let root: string;
let fakeCertbot: string;

function selfSigned(dir: string, host: string, issuer: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "60",
    "-subj", `/CN=${host}/O=${issuer}`,
    "-keyout", path.join(dir, "privkey.pem"), "-out", path.join(dir, "fullchain.pem"),
  ], { stdio: "ignore" });
}

function sandboxEnv(certbot: string): NodeJS.ProcessEnv {
  return { ...process.env, MINI_RAILWAY_TEST_ROOT: root, MINI_RAILWAY_TEST_CERTBOT: certbot };
}

function helper(bin: string, args: string[]) {
  const result = spawnSync("python3", [bin, ...args], { encoding: "utf8", env: sandboxEnv(fakeCertbot) });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "twinsdeploi-tls-"));
  mkdirSync(path.join(root, "etc/nginx/mini-railway.d"), { recursive: true });
  mkdirSync(path.join(root, "run"), { recursive: true });
  fakeCertbot = path.join(root, "fake-certbot");
  // Writes a certificate for the "-d" host under the "--config-dir" given by the helper.
  writeFileSync(fakeCertbot, `#!/bin/sh
host=""; cfg=""; prev=""
for a in "$@"; do [ "$prev" = "-d" ] && host="$a"; [ "$prev" = "--config-dir" ] && cfg="$a"; prev="$a"; done
echo "$@" >> "$(dirname "$0")/certbot.log"
if [ -n "$host" ]; then
  mkdir -p "$cfg/live/$host"
  openssl req -x509 -newkey rsa:2048 -nodes -days 90 -subj "/CN=$host/O=Let's Encrypt" -keyout "$cfg/live/$host/privkey.pem" -out "$cfg/live/$host/fullchain.pem" 2>/dev/null
fi
exit 0
`, { mode: 0o755 });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("mini-railway-proxy --tls", () => {
  it("refuses --tls without a certificate and --force-https without --tls", () => {
    const noCert = helper(PROXY, ["apply", "--host", "nocert.example.com", "--port", "20001", "--tls"]);
    expect(noCert.code).toBe(2);
    expect(noCert.stderr).toContain("no certificate for nocert.example.com");
    const noTls = helper(PROXY, ["apply", "--host", "nocert.example.com", "--port", "20001", "--force-https"]);
    expect(noTls.code).toBe(2);
    expect(noTls.stderr).toContain("--force-https needs --tls");
    expect(existsSync(path.join(root, "etc/nginx/mini-railway.d/nocert.example.com.conf"))).toBe(false);
  });

  it("writes an HTTP vhost that answers the ACME challenge, then an HTTPS vhost", () => {
    const conf = path.join(root, "etc/nginx/mini-railway.d/app.example.com.conf");
    const http = helper(PROXY, ["apply", "--host", "app.example.com", "--port", "20001"]);
    expect(http.code).toBe(0);
    let text = readFileSync(conf, "utf8");
    expect(text.startsWith("# mini-railway: host=app.example.com port=20001 tls=0\n")).toBe(true);
    expect(text).toContain("location ^~ /.well-known/acme-challenge/");
    expect(text).toContain(path.join(root, "var/lib/mini-railway/acme"));
    expect(text).not.toContain("listen 443");

    selfSigned(path.join(root, "etc/letsencrypt/live/app.example.com"), "app.example.com", "Test CA");
    const tls = helper(PROXY, ["apply", "--host", "app.example.com", "--port", "20001", "--tls", "--force-https"]);
    expect(tls.code).toBe(0);
    expect(JSON.parse(tls.stdout)).toEqual({ ok: true, host: "app.example.com", port: 20001, changed: true });
    text = readFileSync(conf, "utf8");
    expect(text.startsWith("# mini-railway: host=app.example.com port=20001 tls=1\n")).toBe(true);
    expect(text).toContain("listen 443 ssl http2;");
    expect(text).toContain("ssl_certificate " + path.join(root, "etc/letsencrypt/live/app.example.com/fullchain.pem"));
    expect(text).toContain("return 301 https://$host$request_uri;");
    expect(text).toContain("proxy_pass http://127.0.0.1:20001;");
    expect(text).toContain("Strict-Transport-Security");
    // The redirect must not swallow the ACME challenge: the challenge location comes first.
    expect(text.indexOf("acme-challenge")).toBeLessThan(text.indexOf("return 301"));

    const list = JSON.parse(helper(PROXY, ["list"]).stdout) as { entries: Array<Record<string, unknown>> };
    expect(list.entries).toContainEqual({ host: "app.example.com", port: 20001, tls: true });

    const plain = helper(PROXY, ["apply", "--host", "app.example.com", "--port", "20001", "--tls"]);
    expect(plain.code).toBe(0);
    text = readFileSync(conf, "utf8");
    expect(text).not.toContain("return 301");
    expect(text.split("proxy_pass http://127.0.0.1:20001;").length).toBe(3);
  });
});

describe("mini-railway-cert", () => {
  it("refuses local and malformed names", () => {
    for (const host of ["app.test", "db.localhost", "svc.internal", "bad host", "nodots", "-x.example.com"]) {
      const result = helper(CERT, ["issue", "--host", host]);
      expect(result.code, host).toBe(2);
    }
    expect(helper(CERT, ["issue", "--host", "ok.example.com", "--email", "not-an-email"]).code).toBe(2);
  });

  it("issues, reports, renews and removes through certbot", () => {
    const before = JSON.parse(helper(CERT, ["status", "--host", "new.example.com"]).stdout);
    expect(before).toEqual({ ok: true, host: "new.example.com", exists: false });

    const issued = helper(CERT, ["issue", "--host", "new.example.com", "--email", "ops@example.com"]);
    expect(issued.code).toBe(0);
    const payload = JSON.parse(issued.stdout) as { ok: boolean; host: string; issuer: string; expiresAt: string };
    expect(payload.ok).toBe(true);
    expect(payload.host).toBe("new.example.com");
    expect(payload.issuer).toBe("Let's Encrypt");
    expect(new Date(payload.expiresAt).getTime()).toBeGreaterThan(Date.now() + 80 * 24 * 3600 * 1000);

    const log = readFileSync(path.join(root, "certbot.log"), "utf8");
    expect(log).toContain("certonly --non-interactive --agree-tos --keep-until-expiring --webroot --webroot-path");
    expect(log).toContain(`${path.join(root, "var/lib/mini-railway/acme")}`);
    expect(log).toContain("--cert-name new.example.com -d new.example.com --email ops@example.com");

    const status = JSON.parse(helper(CERT, ["status", "--host", "new.example.com"]).stdout) as { exists: boolean; issuer: string };
    expect(status.exists).toBe(true);
    expect(status.issuer).toBe("Let's Encrypt");

    const renew = JSON.parse(helper(CERT, ["renew"]).stdout) as { ok: boolean; certificates: Array<{ host: string }> };
    expect(renew.ok).toBe(true);
    expect(renew.certificates.map((c) => c.host)).toContain("new.example.com");
    expect(readFileSync(path.join(root, "certbot.log"), "utf8")).toContain("renew --non-interactive --webroot");

    const removed = JSON.parse(helper(CERT, ["remove", "--host", "new.example.com"]).stdout);
    expect(removed).toEqual({ ok: true, host: "new.example.com", changed: true });
    expect(readFileSync(path.join(root, "certbot.log"), "utf8")).toContain("delete --non-interactive --cert-name new.example.com");
  });

  it("fails with code 5 when certbot is missing and 3 when it fails", () => {
    const missing = spawnSync("python3", [CERT, "issue", "--host", "x.example.com"], {
      encoding: "utf8",
      env: sandboxEnv(path.join(root, "absent")),
    });
    expect(missing.status).toBe(5);
    const failing = path.join(root, "failing-certbot");
    writeFileSync(failing, "#!/bin/sh\necho 'Challenge failed for domain x.example.com' >&2\nexit 1\n", { mode: 0o755 });
    const failed = spawnSync("python3", [CERT, "issue", "--host", "x.example.com"], {
      encoding: "utf8",
      env: sandboxEnv(failing),
    });
    expect(failed.status).toBe(3);
    expect(failed.stderr).toContain("Challenge failed");
  });
});

describe("certificateUsable", () => {
  it("needs an expiry more than a day away", () => {
    const now = Date.now();
    expect(certificateUsable(null, now)).toBe(false);
    expect(certificateUsable({ issuer: "x", expiresAt: null }, now)).toBe(false);
    expect(certificateUsable({ issuer: "x", expiresAt: new Date(now + 3600_000) }, now)).toBe(false);
    expect(certificateUsable({ issuer: "x", expiresAt: new Date(now + 48 * 3600_000) }, now)).toBe(true);
  });
});
