import { z } from "zod";

import {
  ApiError,
  assertTrustedMutation,
  handleRouteError,
  jsonResponse,
  parseJson,
} from "@/lib/api";
import { getCurrentUser, publicUserSelect } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRequestMetadata, isValidTimeZone } from "@/lib/security";

export const runtime = "nodejs";

const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidTimeZone, "Unknown IANA time zone")
      .optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, "At least one field is required");

export async function GET() {
  try {
    const user = await requireApiUser();
    return jsonResponse({ user });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const input = await parseJson(request, updateProfileSchema);
    const metadata = getRequestMetadata(request);

    const updated = await prisma.$transaction(async (tx) => {
      const profile = await tx.user.update({
        where: { id: user.id },
        data: input,
        select: publicUserSelect,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "PROFILE_UPDATED",
          entityType: "User",
          entityId: user.id,
          metadata: { changedFields: Object.keys(input) },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });

      return profile;
    });

    return jsonResponse({ user: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }
  return user;
}
