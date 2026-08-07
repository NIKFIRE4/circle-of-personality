import { GoalsWorkspace } from "@/components/goals/goals-workspace";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { goalSelect, serializeGoal } from "@/lib/goals";
import { redirect } from "next/navigation";

export default async function GoalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const [goals, categories] = await Promise.all([
    prisma.goal.findMany({
      where: { userId: user.id, status: { not: "ARCHIVED" } },
      select: goalSelect,
      orderBy: [{ status: "asc" }, { targetDate: "asc" }, { createdAt: "desc" }],
    }),
    prisma.balanceCategory.findMany({
      where: { userId: user.id, isArchived: false },
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        icon: true,
        targetMinutesPerWeek: true,
        sortOrder: true,
        isArchived: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <main className="page-content">
      <GoalsWorkspace initialGoals={goals.map(serializeGoal)} categories={categories} />
    </main>
  );
}
