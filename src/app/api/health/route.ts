import { prisma } from "@/lib/db";
import { jsonResponse } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SPEECH_PROBE_TIMEOUT_MS = 20_000;

export async function GET(request: Request) {
  const startedAt = Date.now();
  // The speech container can be slow to wake, so it is only probed on demand
  // (/api/health?speech=1) and never as part of the default liveness check.
  const probeSpeech = new URL(request.url).searchParams.get("speech") === "1";

  try {
    await prisma.$queryRaw`SELECT 1`;

    return jsonResponse({
      status: "ok",
      checks: {
        database: "up",
        ...(probeSpeech ? { speech: await checkSpeechService() } : {}),
      },
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

type SpeechCheck = {
  status: "up" | "down" | "not_configured";
  /** Whether the Vercel service binding populated SPEECH_SERVICE_URL. */
  bound: boolean;
  detail?: string;
  responseTimeMs?: number;
};

/**
 * Reports whether the speech container is reachable without ever echoing its
 * internal URL, which is a private service binding.
 */
async function checkSpeechService(): Promise<SpeechCheck> {
  if (process.env.VOICE_DEMO_MODE === "true") {
    return { status: "not_configured", bound: false, detail: "VOICE_DEMO_MODE is on" };
  }

  const configuredUrl = process.env.SPEECH_SERVICE_URL;
  if (!configuredUrl) {
    return { status: "not_configured", bound: false, detail: "SPEECH_SERVICE_URL is unset" };
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(`${configuredUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(SPEECH_PROBE_TIMEOUT_MS),
    });
    const responseTimeMs = Date.now() - startedAt;

    return response.ok
      ? { status: "up", bound: true, responseTimeMs }
      : { status: "down", bound: true, detail: `HTTP ${response.status}`, responseTimeMs };
  } catch (error) {
    const timedOut = error instanceof Error
      && (error.name === "TimeoutError" || error.name === "AbortError");

    return {
      status: "down",
      bound: true,
      detail: timedOut ? "timed out (container may be cold)" : "unreachable",
      responseTimeMs: Date.now() - startedAt,
    };
  }
}
