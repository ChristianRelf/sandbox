import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  transpilePackages: ["@sandbox/brand", "@sandbox/ui"],
  allowedDevOrigins: ["127.0.0.1"],
};
export default nextConfig;
