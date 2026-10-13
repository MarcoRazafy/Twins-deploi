import type { NextConfig } from "next";

// Loopback port of the terminal service (src/terminal/main.ts), read at build time.
const terminalPort = Number(process.env.MINI_RAILWAY_TERMINAL_PORT ?? 3101);

const nextConfig: NextConfig = {
  // The server console is a WebSocket: route handlers cannot upgrade a connection,
  // so the handshake is proxied to the terminal service, which does all the checks.
  async rewrites() {
    return [{ source: "/api/terminal/ws", destination: `http://127.0.0.1:${terminalPort}/ws` }];
  },
  experimental: {
    // The persistent Turbopack caches grow to several hundred MB; this
    // machine is short on disk space, so they are turned off (cold starts are
    // a little slower, nothing else changes).
    turbopackFileSystemCacheForDev: false,
    turbopackFileSystemCacheForBuild: false,
  },
};

export default nextConfig;
