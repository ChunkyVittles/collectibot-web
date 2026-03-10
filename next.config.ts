import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  transpilePackages: ["pg", "pg-pool", "pg-protocol", "pg-types", "pg-connection-string"],
};

export default nextConfig;
