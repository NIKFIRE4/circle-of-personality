import { createHash, createHmac, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digestSensitive(value: string): string {
  const secret = process.env.AUDIT_HASH_SECRET;

  if (!secret) {
    return sha256(value);
  }

  return createHmac("sha256", secret).update(value).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type RequestMetadata = {
  ipHash?: string;
  userAgent?: string;
};

export function getRequestMetadata(request: Request): RequestMetadata {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const ip = forwardedFor || realIp;
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) || undefined;

  return {
    ipHash: ip ? digestSensitive(ip) : undefined,
    userAgent,
  };
}

export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");

  // Non-browser clients often omit Origin. SameSite cookies still protect browser requests.
  if (!origin) {
    return true;
  }

  try {
    const expectedOrigin = process.env.APP_URL
      ? new URL(process.env.APP_URL).origin
      : new URL(request.url).origin;

    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
