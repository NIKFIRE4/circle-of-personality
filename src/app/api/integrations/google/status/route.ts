import { ApiError, handleRouteError, jsonResponse } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleConfigurationStatus } from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      throw new ApiError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication is required",
      );
    }

    const [configuration, connections] = await Promise.all([
      getGoogleConfigurationStatus(user.id, new URL(request.url).origin),
      prisma.calendarConnection.findMany({
        where: { provider: "GOOGLE", userId: user.id },
        orderBy: { createdAt: "asc" },
        select: {
          accountEmail: true,
          createdAt: true,
          id: true,
          lastSyncedAt: true,
          refreshTokenEncrypted: true,
        },
      }),
    ]);

    const primaryConnection = connections[0] ?? null;

    return jsonResponse({
      accountEmail: primaryConnection?.accountEmail ?? null,
      accounts: connections.map((connection) => ({
        accountEmail: connection.accountEmail,
        connectedAt: connection.createdAt,
        id: connection.id,
        lastSyncedAt: connection.lastSyncedAt,
        requiresReconnect: !connection.refreshTokenEncrypted,
      })),
      configured: configuration.configured,
      configuration,
      connected: connections.length > 0,
      connectionId: primaryConnection?.id ?? null,
      lastSyncedAt: primaryConnection?.lastSyncedAt ?? null,
      provider: "GOOGLE",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
