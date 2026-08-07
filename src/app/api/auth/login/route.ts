import { compare } from "bcryptjs";
import { z } from "zod";

import { ApiError, assertTrustedMutation, handleRouteError, jsonResponse, parseJson } from "@/lib/api";
import { createSession, publicUserSelect, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { digestSensitive, getRequestMetadata, normalizeEmail } from "@/lib/security";

export const runtime = "nodejs";

const DUMMY_PASSWORD_HASH =
  "$2b$12$/I9/dDgBWnn31e.dCGXnCehiXxrcU4BvRqvWnABlnGsLXhivHtZiK";

const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(72),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = await parseJson(request, loginSchema);
    const email = normalizeEmail(input.email);
    const metadata = getRequestMetadata(request);
    const account = await prisma.user.findUnique({
      where: { email },
      select: { ...publicUserSelect, passwordHash: true },
    });
    const passwordMatches = await compare(
      input.password,
      account?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!account || !passwordMatches) {
      await prisma.auditLog.create({
        data: {
          action: "AUTH_LOGIN_FAILED",
          entityType: "User",
          metadata: { emailHash: digestSensitive(email) },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });

      throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }

    const user = {
      id: account.id,
      email: account.email,
      name: account.name,
      timeZone: account.timeZone,
      lastLoginAt: account.lastLoginAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
    const loginAt = new Date();
    const session = await createSession(user.id, metadata);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: loginAt },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "AUTH_LOGIN_SUCCEEDED",
          entityType: "Session",
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      }),
    ]);

    await setSessionCookie(session.token, session.expiresAt);

    return jsonResponse({
      user: { ...user, lastLoginAt: loginAt },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
