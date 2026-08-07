import { assertTrustedMutation, handleRouteError, jsonResponse } from "@/lib/api";
import { revokeCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRequestMetadata } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const session = await revokeCurrentSession();

    if (session) {
      const metadata = getRequestMetadata(request);
      await prisma.auditLog.create({
        data: {
          actorUserId: session.user.id,
          action: "AUTH_LOGGED_OUT",
          entityType: "Session",
          entityId: session.id,
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });
    }

    return jsonResponse({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
