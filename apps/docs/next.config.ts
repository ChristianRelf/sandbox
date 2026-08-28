import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@sandbox/brand", "@sandbox/ui"],
  allowedDevOrigins: ["127.0.0.1"],
};

export default config;
