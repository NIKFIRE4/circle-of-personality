import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { generateOpaqueToken, sha256, type RequestMetadata } from "@/lib/security";

const SESSION_TTL_SECONDS = getSessionTtlSeconds();
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME ||
  (process.env.NODE_ENV === "production"
    ? "__Host-life_balance_session"
    : "life_balance_session");

export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  timeZone: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;

export type AuthenticatedSession = {
  id: string;
  expiresAt: Date;
  user: PublicUser;
};

export class AuthenticationError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthenticationError";
  }
}

function getSessionTtlSeconds(): number {
  const configured = Number(process.env.SESSION_TTL_SECONDS);

  if (Number.isSafeInteger(configured) && configured >= 60 * 60) {
    return configured;
  }

  return 60 * 60 * 24 * 30;
}

function cookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    priority: "high" as const,
    ...(expires ? { expires } : {}),
  };
}

export async function createSession(
  userId: string,
  metadata: RequestMetadata = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await prisma.session.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    },
  });

  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, cookieOptions(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...cookieOptions(new Date(0)),
    maxAge: 0,
  });
}

export async function getSessionFromToken(
  token: string | null | undefined,
): Promise<AuthenticatedSession | null> {
  if (!token) {
    return null;
  }

  const now = new Date();
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      user: { select: publicUserSelect },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= now) {
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    await prisma.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
      data: { lastSeenAt: now },
    });
  }

  return {
    id: session.id,
    expiresAt: session.expiresAt,
    user: session.user,
  };
}

export async function getSession(): Promise<AuthenticatedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return getSessionFromToken(token);
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  return (await getSession())?.user ?? null;
}

export async function requireCurrentUser(): Promise<PublicUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthenticationError();
  }

  return user;
}

export async function revokeCurrentSession(): Promise<AuthenticatedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionFromToken(token);

  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await clearSessionCookie();
  return session;
}
