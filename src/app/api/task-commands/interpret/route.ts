import { z } from "zod";

import {
  ApiError,
  assertTrustedMutation,
  handleRouteError,
  jsonResponse,
  parseJson,
} from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertTaskCommandRateLimit } from "@/lib/task-command-rate-limit";
import { interpretTaskCommand } from "@/lib/task-interpreter";
import { VoiceCommandParseError } from "@/lib/voice-command";

export const runtime = "nodejs";

const taskCommandSchema = z.object({
  text: z.string().trim().min(1).max(1_000),
}).strict();

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await getCurrentUser();
    if (!user) {
      throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Сначала войдите в аккаунт.");
    }
    assertTaskCommandRateLimit(user.id);

    const { text } = await parseJson(request, taskCommandSchema);
    const categories = await prisma.balanceCategory.findMany({
      where: { userId: user.id, isArchived: false },
      select: { id: true, name: true, slug: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    const result = await interpretTaskCommand({
      text,
      categories,
      timeZone: user.timeZone,
      now: new Date(),
    });

    return jsonResponse({
      text,
      event: result.event,
      interpreter: result.interpreter,
    });
  } catch (error) {
    const routeError = error instanceof VoiceCommandParseError
      ? new ApiError(error.status, error.code, error.message)
      : error;
    return handleRouteError(routeError);
  }
}
