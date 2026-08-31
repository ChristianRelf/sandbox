import path from "node:path";
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@sandbox/brand", "@sandbox/product-ui", "@sandbox/ui"],
  allowedDevOrigins: ["127.0.0.1"],
};
export default nextConfig;
