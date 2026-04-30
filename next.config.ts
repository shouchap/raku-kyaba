import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  /** 親ディレクトリに別 lockfile がある環境での tracing 誤検知を防ぐ */
  outputFileTracingRoot: __dirname,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
