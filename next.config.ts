import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel's native Next.js builder manages its own output tracing. The
  // standalone bundle is only needed by the self-hosted Docker image.
  output: process.env.VERCEL === "1" ? undefined : "standalone",
  images: {
    // The vercel.json catch-all rewrite that routes every path to the
    // "frontend" service (needed for the speech service binding) also
    // swallows /_next/image, which 404s the Image Optimization endpoint
    // in production. Serve unoptimized <Image> output instead so the
    // logo and body illustrations load from the static files directly.
    unoptimized: true,
  },
};

export default nextConfig;
