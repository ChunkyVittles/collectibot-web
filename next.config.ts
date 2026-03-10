import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  transpilePackages: ["pg", "pg-cloudflare", "pg-pool", "pg-protocol", "pg-types"],
};

export default nextConfig;
