import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { ApiError, assertTrustedMutation, handleRouteError, jsonResponse, parseJson } from "@/lib/api";
import { createSession, publicUserSelect, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_BALANCE_CATEGORIES } from "@/lib/default-categories";
import { getRequestMetadata, isValidTimeZone, normalizeEmail } from "@/lib/security";

export const runtime = "nodejs";

const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email().max(254),
    password: z
      .string()
      .min(10)
      .max(72)
      .regex(/[A-Za-zА-Яа-яЁё]/u, "Password must contain a letter")
      .regex(/\d/u, "Password must contain a number"),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidTimeZone, "Unknown IANA time zone")
      .default("Europe/Moscow"),
  })
  .strict();

function passwordCost(): number {
  const configured = Number(process.env.BCRYPT_ROUNDS);
  return Number.isInteger(configured) && configured >= 10 && configured <= 14
    ? configured
    : 12;
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = await parseJson(request, registerSchema);
    const email = normalizeEmail(input.email);
    const passwordHash = await hash(input.password, passwordCost());
    const metadata = getRequestMetadata(request);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: input.name,
          email,
          passwordHash,
          timeZone: input.timeZone,
          balanceCategories: {
            create: DEFAULT_BALANCE_CATEGORIES.map((category) => ({ ...category })),
          },
        },
        select: publicUserSelect,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: created.id,
          action: "AUTH_REGISTERED",
          entityType: "User",
          entityId: created.id,
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });

      await tx.outbox.create({
        data: {
          userId: created.id,
          topic: "user.registered",
          aggregateType: "User",
          aggregateId: created.id,
          payload: { userId: created.id, email: created.email },
        },
      });

      return created;
    });

    const session = await createSession(user.id, metadata);
    await setSessionCookie(session.token, session.expiresAt);

    return jsonResponse({ user }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonResponse(
        {
          error: {
            code: "EMAIL_ALREADY_EXISTS",
            message: "An account with this email already exists",
          },
        },
        { status: 409 },
      );
    }

    if (error instanceof ApiError) {
      return handleRouteError(error);
    }

    return handleRouteError(error);
  }
}
