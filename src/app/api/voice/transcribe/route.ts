import { ApiError, assertTrustedMutation, handleRouteError, jsonResponse } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertTaskCommandRateLimit } from "@/lib/task-command-rate-limit";
import { interpretTaskCommand } from "@/lib/task-interpreter";
import {
  VoiceCommandParseError,
} from "@/lib/voice-command";

export const runtime = "nodejs";
// Without this the platform applies its own (much lower) default and kills the
// function mid-request, so none of the error handling below ever runs and the
// browser only sees a raw gateway error. 60s is the Hobby-plan ceiling.
export const maxDuration = 60;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Speech and the AI parser run back to back, so their timeouts have to fit
// inside maxDuration together with request overhead: 30 + 20 + slack < 60.
const SPEECH_TIMEOUT_MS = 30_000;

export async function POST(request: Request) {
  let commandId: string | undefined;
  let transcript = "";
  try {
    assertTrustedMutation(request);
    const user = await getCurrentUser();
    if (!user) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Сначала войдите в аккаунт.");
    assertTaskCommandRateLimit(user.id);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES + 1_000_000) {
      throw new ApiError(413, "AUDIO_TOO_LARGE", "Запись слишком большая. Попробуйте более короткую команду.");
    }

    const body = await request.formData();
    const audio = body.get("file");
    if (!(audio instanceof File) || audio.size === 0) {
      throw new ApiError(400, "AUDIO_REQUIRED", "Запись не получена. Попробуйте ещё раз.");
    }
    if (audio.size > MAX_UPLOAD_BYTES) {
      throw new ApiError(413, "AUDIO_TOO_LARGE", "Запись слишком большая. Попробуйте более короткую команду.");
    }

    const command = await prisma.voiceCommand.create({ data: { userId: user.id, status: "TRANSCRIBING" }, select: { id: true } });
    commandId = command.id;

    if (process.env.VOICE_DEMO_MODE === "true") {
      transcript = "Поставь на эту пятницу задачу, с 13 до 17, танцы";
    } else {
      const upstreamBody = new FormData();
      upstreamBody.append("file", audio, audio.name || "command.webm");
      const endpoint = `${(process.env.SPEECH_SERVICE_URL || "http://127.0.0.1:8001").replace(/\/$/, "")}/transcribe`;
      let upstream: Response;
      try {
        upstream = await fetch(endpoint, { method: "POST", body: upstreamBody, signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS) });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new ApiError(504, "SPEECH_TIMEOUT", "Сервис распознавания ещё запускается после простоя. Подождите полминуты и повторите команду.");
        }
        throw new ApiError(503, "SPEECH_UNAVAILABLE", "Голосовой ввод временно недоступен. Попробуйте позже или создайте задачу вручную.");
      }
      const payload = await upstream.json().catch(() => ({})) as { text?: string };
      if (!upstream.ok) throw speechServiceError(upstream.status);
      transcript = payload.text?.trim() || "";
      if (!transcript) throw new ApiError(422, "EMPTY_TRANSCRIPT", "Речь не распознана. Говорите чуть громче и ближе к микрофону.");
    }

    const categories = await prisma.balanceCategory.findMany({
      where: { userId: user.id, isArchived: false },
      select: { id: true, name: true, slug: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    const { event, interpreter } = await interpretTaskCommand({
      text: transcript,
      categories,
      timeZone: user.timeZone,
      now: new Date(),
    });
    await prisma.voiceCommand.update({
      where: { id: command.id },
      data: {
        transcript,
        parsedPayload: { ...event, interpreter },
        confidence: event.confidence,
        status: "PARSED",
      },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "VOICE_COMMAND_PARSED",
        entityType: "VoiceCommand",
        entityId: command.id,
        metadata: {
          confidence: event.confidence,
          interpreter: interpreter.mode,
          model: interpreter.model,
        },
      },
    });
    return jsonResponse({ commandId: command.id, transcript, event, interpreter });
  } catch (error) {
    const routeError = error instanceof VoiceCommandParseError
      ? new ApiError(
          error.status,
          error.code,
          error.message,
          transcript ? { transcript } : undefined,
        )
      : error;
    if (commandId) await prisma.voiceCommand.update({ where: { id: commandId }, data: { status: "FAILED", errorMessage: routeError instanceof Error ? routeError.message.slice(0, 1000) : "Неизвестная ошибка" } }).catch(() => undefined);
    return handleRouteError(routeError);
  }
}

function speechServiceError(status: number): ApiError {
  if (status === 413) {
    return new ApiError(413, "AUDIO_TOO_LARGE", "Запись слишком большая. Попробуйте более короткую команду.");
  }
  if (status === 415) {
    return new ApiError(422, "UNSUPPORTED_AUDIO", "Браузер записал неподдерживаемый формат. Попробуйте другой браузер.");
  }
  if (status >= 500) {
    return new ApiError(503, "SPEECH_UNAVAILABLE", "Голосовой ввод временно недоступен. Попробуйте позже или создайте задачу вручную.");
  }
  return new ApiError(422, "TRANSCRIPTION_FAILED", "Не удалось распознать запись. Попробуйте произнести команду ещё раз.");
}
