import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The persistent Turbopack caches grow to several hundred MB; this
    // machine is short on disk space, so they are turned off (cold starts are
    // a little slower, nothing else changes).
    turbopackFileSystemCacheForDev: false,
    turbopackFileSystemCacheForBuild: false,
  },
};

export default nextConfig;
