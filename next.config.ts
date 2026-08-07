import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel's native Next.js builder manages its own output tracing. The
  // standalone bundle is only needed by the self-hosted Docker image.
  output: process.env.VERCEL === "1" ? undefined : "standalone",
};

export default nextConfig;
