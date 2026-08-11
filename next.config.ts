import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "pino", "pino-pretty"],
};

export default nextConfig;
