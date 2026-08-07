import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { hasTrustedOrigin } from "./security";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Pragma", "no-cache");

  return NextResponse.json(data, { ...init, headers });
}

export function apiErrorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse {
  return jsonResponse(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status },
  );
}

export async function parseJson<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }

  let input: unknown;

  try {
    input = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body contains invalid JSON");
  }

  const result = schema.safeParse(input);

  if (!result.success) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Request validation failed",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  return result.data;
}

export function assertTrustedMutation(request: Request): void {
  if (!hasTrustedOrigin(request)) {
    throw new ApiError(403, "UNTRUSTED_ORIGIN", "Request origin is not allowed");
  }
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return apiErrorResponse(error.status, error.code, error.message, error.details);
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    return apiErrorResponse(404, "NOT_FOUND", "Requested resource was not found");
  }

  console.error("Unhandled API error", error);
  return apiErrorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred");
}
