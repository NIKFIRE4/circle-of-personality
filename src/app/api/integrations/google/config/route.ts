import { z } from "zod";

import {
  ApiError,
  apiErrorResponse,
  assertTrustedMutation,
  handleRouteError,
  jsonResponse,
  parseJson,
} from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  encryptGoogleClientSecret,
  getGoogleConfigurationStatus,
  GoogleCalendarError,
} from "@/lib/google-calendar";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

const googleConfigurationSchema = z
  .object({
    clientId: z.string().trim().min(8).max(512),
    clientSecret: z.string().trim().min(8).max(4096),
  })
  .strict();

async function requireApiUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new ApiError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authentication is required",
    );
  }

  return user;
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const status = await getGoogleConfigurationStatus(
      user.id,
      new URL(request.url).origin,
    );

    return jsonResponse(status);
  } catch (error) {
    return googleRouteError(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const input = await parseJson(request, googleConfigurationSchema);
    const metadata = getRequestMetadata(request);
    const clientSecretEncrypted = encryptGoogleClientSecret(
      input.clientSecret,
      user.id,
    );

    await prisma.$transaction(async (tx) => {
      const activeConnections = await tx.calendarConnection.count({
        where: { provider: "GOOGLE", userId: user.id },
      });

      if (activeConnections > 0) {
        throw new ApiError(
          409,
          "GOOGLE_DISCONNECT_REQUIRED",
          "Disconnect Google Calendar before replacing OAuth credentials",
        );
      }

      const existing = await tx.googleCalendarConfig.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      const saved = await tx.googleCalendarConfig.upsert({
        where: { userId: user.id },
        create: {
          clientId: input.clientId,
          clientSecretEncrypted,
          redirectUri: null,
          userId: user.id,
        },
        update: {
          clientId: input.clientId,
          clientSecretEncrypted,
          redirectUri: null,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          action: existing
            ? "GOOGLE_CALENDAR_CONFIG_UPDATED"
            : "GOOGLE_CALENDAR_CONFIG_CREATED",
          actorUserId: user.id,
          entityId: saved.id,
          entityType: "GoogleCalendarConfig",
          ipHash: metadata.ipHash,
          metadata: { clientIdSuffix: input.clientId.slice(-12) },
          userAgent: metadata.userAgent,
        },
      });
    });

    return jsonResponse(
      await getGoogleConfigurationStatus(user.id, new URL(request.url).origin),
    );
  } catch (error) {
    return googleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const metadata = getRequestMetadata(request);
    let deleted = false;

    await prisma.$transaction(async (tx) => {
      const activeConnections = await tx.calendarConnection.count({
        where: { provider: "GOOGLE", userId: user.id },
      });

      if (activeConnections > 0) {
        throw new ApiError(
          409,
          "GOOGLE_DISCONNECT_REQUIRED",
          "Disconnect Google Calendar before deleting OAuth credentials",
        );
      }

      const existing = await tx.googleCalendarConfig.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });

      if (!existing) {
        return;
      }

      await tx.googleCalendarConfig.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          action: "GOOGLE_CALENDAR_CONFIG_DELETED",
          actorUserId: user.id,
          entityId: existing.id,
          entityType: "GoogleCalendarConfig",
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });
      deleted = true;
    });

    return jsonResponse({
      deleted,
      configuration: await getGoogleConfigurationStatus(
        user.id,
        new URL(request.url).origin,
      ),
    });
  } catch (error) {
    return googleRouteError(error);
  }
}

function googleRouteError(error: unknown) {
  if (error instanceof GoogleCalendarError) {
    return apiErrorResponse(error.status, error.code, error.message);
  }

  return handleRouteError(error);
}
