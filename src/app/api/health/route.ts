import { prisma } from "@/lib/db";
import { jsonResponse } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return jsonResponse({
      status: "ok",
      checks: { database: "up" },
      responseTimeMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check failed", error);

    return jsonResponse(
      {
        status: "degraded",
        checks: { database: "down" },
        responseTimeMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
