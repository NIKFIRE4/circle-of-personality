import { ApiError, assertTrustedMutation, handleRouteError, jsonResponse, parseJson } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import {
  categoriesQuerySchema,
  categorySelect,
  createCategorySchema,
  slugifyCategoryName,
} from "@/lib/categories";
import { prisma } from "@/lib/db";
import { getRequestMetadata } from "@/lib/security";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";

async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return user;
}

async function availableSlug(userId: string, requestedSlug: string | undefined, name: string) {
  const base = requestedSlug ?? slugifyCategoryName(name);
  const matches = await prisma.balanceCategory.findMany({
    where: { userId, slug: { startsWith: base } },
    select: { slug: true },
  });
  const occupied = new Set(matches.map((category) => category.slug));

  if (!occupied.has(base)) return base;

  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, 64 - suffixText.length).replace(/-+$/g, "")}${suffixText}`;
    if (!occupied.has(candidate)) return candidate;
  }

  throw new ApiError(409, "CATEGORY_SLUG_CONFLICT", "Could not create a unique category identifier");
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const parsed = categoriesQuerySchema.safeParse({
      includeArchived: url.searchParams.get("includeArchived") ?? undefined,
    });

    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_ERROR", "Query validation failed", parsed.error.issues);
    }

    const categories = await prisma.balanceCategory.findMany({
      where: {
        userId: user.id,
        ...(parsed.data.includeArchived ? {} : { isArchived: false }),
      },
      select: categorySelect,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return jsonResponse({ categories });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const input = await parseJson(request, createCategorySchema);
    const metadata = getRequestMetadata(request);
    const [slug, maximumSortOrder] = await Promise.all([
      availableSlug(user.id, input.slug, input.name),
      prisma.balanceCategory.aggregate({
        where: { userId: user.id },
        _max: { sortOrder: true },
      }),
    ]);

    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.balanceCategory.create({
        data: {
          userId: user.id,
          name: input.name,
          slug,
          color: input.color,
          icon: input.icon,
          targetMinutesPerWeek: input.targetMinutesPerWeek,
          sortOrder: input.sortOrder ?? (maximumSortOrder._max.sortOrder ?? -1) + 1,
        },
        select: categorySelect,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "BALANCE_CATEGORY_CREATED",
          entityType: "BalanceCategory",
          entityId: created.id,
          metadata: { slug: created.slug },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });
      await tx.outbox.create({
        data: {
          userId: user.id,
          topic: "balance-category.created",
          aggregateType: "BalanceCategory",
          aggregateId: created.id,
          payload: { categoryId: created.id, userId: user.id },
        },
      });

      return created;
    });

    revalidatePath("/overview");

    return jsonResponse({ category }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
