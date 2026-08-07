import { ApiError, assertTrustedMutation, handleRouteError, jsonResponse, parseJson } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { categorySelect, updateCategorySchema } from "@/lib/categories";
import { prisma } from "@/lib/db";
import { getRequestMetadata } from "@/lib/security";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";

type CategoryRouteContext = { params: Promise<{ id: string }> };

async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  return user;
}

async function getOwnedCategory(id: string, userId: string) {
  const category = await prisma.balanceCategory.findFirst({
    where: { id, userId },
    select: categorySelect,
  });
  if (!category) throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category was not found");
  return category;
}

export async function GET(_request: Request, context: CategoryRouteContext) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    return jsonResponse({ category: await getOwnedCategory(id, user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, context: CategoryRouteContext) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const input = await parseJson(request, updateCategorySchema);
    const existing = await getOwnedCategory(id, user.id);
    const metadata = getRequestMetadata(request);

    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.balanceCategory.update({
        where: { id: existing.id },
        data: input,
        select: categorySelect,
      });
      const changedFields = Object.keys(input);

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "BALANCE_CATEGORY_UPDATED",
          entityType: "BalanceCategory",
          entityId: updated.id,
          metadata: { changedFields },
          ipHash: metadata.ipHash,
          userAgent: metadata.userAgent,
        },
      });
      await tx.outbox.create({
        data: {
          userId: user.id,
          topic: "balance-category.updated",
          aggregateType: "BalanceCategory",
          aggregateId: updated.id,
          payload: { categoryId: updated.id, userId: user.id, changedFields },
        },
      });

      return updated;
    });

    revalidatePath("/overview");

    return jsonResponse({ category });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, context: CategoryRouteContext) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const existing = await getOwnedCategory(id, user.id);
    const metadata = getRequestMetadata(request);

    if (!existing.isArchived) {
      await prisma.$transaction(async (tx) => {
        await tx.balanceCategory.update({ where: { id: existing.id }, data: { isArchived: true } });
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: "BALANCE_CATEGORY_ARCHIVED",
            entityType: "BalanceCategory",
            entityId: existing.id,
            ipHash: metadata.ipHash,
            userAgent: metadata.userAgent,
          },
        });
        await tx.outbox.create({
          data: {
            userId: user.id,
            topic: "balance-category.archived",
            aggregateType: "BalanceCategory",
            aggregateId: existing.id,
            payload: { categoryId: existing.id, userId: user.id },
          },
        });
      });

      revalidatePath("/overview");
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    return handleRouteError(error);
  }
}
