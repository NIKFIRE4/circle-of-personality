import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

import { DEFAULT_BALANCE_CATEGORIES } from "../src/lib/default-categories";
import { DEFAULT_GOAL_TEMPLATES, targetDateFromHorizon } from "../src/lib/default-goals";

const prisma = new PrismaClient();

async function ensureCategories(userId: string) {
  await prisma.$transaction(
    DEFAULT_BALANCE_CATEGORIES.map((category) =>
      prisma.balanceCategory.upsert({
        where: { userId_slug: { userId, slug: category.slug } },
        create: { userId, ...category },
        update: {
          name: category.name,
          color: category.color,
          icon: category.icon,
          sortOrder: category.sortOrder,
        },
      }),
    ),
  );
}

async function ensureStarterGoals(userId: string) {
  if (await prisma.goal.count({ where: { userId } })) return;
  const categories = await prisma.balanceCategory.findMany({ where: { userId }, select: { id: true, slug: true } });
  const categoryIds = new Map(categories.map((category) => [category.slug, category.id]));
  for (const template of DEFAULT_GOAL_TEMPLATES) {
    const categoryId = categoryIds.get(template.categorySlug);
    if (!categoryId) continue;
    await prisma.goal.create({
      data: {
        userId,
        categoryId,
        title: template.title,
        description: template.description,
        unit: "результат",
        currentValue: 0,
        targetValue: 1,
        targetDate: targetDateFromHorizon(template.horizonDays),
        tasks: { create: template.tasks.map((task, sortOrder) => ({ userId, ...task, sortOrder })) },
      },
    });
  }
}

async function main() {
  const demoEmail = process.env.SEED_DEMO_EMAIL?.trim().toLowerCase();
  const demoPassword = process.env.SEED_DEMO_PASSWORD;

  if (demoEmail && demoPassword) {
    if (demoPassword.length < 10 || demoPassword.length > 72) {
      throw new Error("SEED_DEMO_PASSWORD must contain between 10 and 72 characters");
    }

    const passwordHash = await hash(demoPassword, 12);
    await prisma.user.upsert({
      where: { email: demoEmail },
      create: {
        email: demoEmail,
        name: process.env.SEED_DEMO_NAME?.trim() || "Demo User",
        passwordHash,
        timeZone: process.env.SEED_DEMO_TIME_ZONE?.trim() || "Europe/Moscow",
      },
      update: {},
    });
  }

  const users = await prisma.user.findMany({ select: { id: true } });

  for (const user of users) {
    await ensureCategories(user.id);
    await ensureStarterGoals(user.id);
  }

  if (demoEmail) {
    const demoUser = await prisma.user.findUnique({ where: { email: demoEmail }, select: { id: true } });
    if (demoUser && await prisma.event.count({ where: { userId: demoUser.id } }) === 0) {
      const categories = await prisma.balanceCategory.findMany({ where: { userId: demoUser.id }, select: { id: true, slug: true } });
      const categoryId = Object.fromEntries(categories.map(category => [category.slug, category.id]));
      const now = new Date();
      const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); monday.setHours(6, 0, 0, 0);
      const at = (dayOffset: number, hour: number, minute = 0) => { const date = new Date(monday); date.setDate(date.getDate() + dayOffset); date.setHours(hour, minute, 0, 0); return date; };
      const duration = (start: Date, minutes: number) => new Date(start.getTime() + minutes * 60_000);
      const completed = [
        ["health", "Кардио и восстановление", 0, 6, 228], ["career", "Глубокая работа", 0, 9, 504],
        ["relationships", "Время с близкими", 1, 10, 173], ["growth", "Практика английского", 2, 10, 204],
        ["finance", "Финансовое планирование", 2, 14, 98], ["rest", "Осознанный отдых", 0, 18, 256],
      ] as const;
      await prisma.event.createMany({ data: completed.map(([slug,title,day,hour,minutes]) => { const startAt=at(day,hour); return { userId:demoUser.id,categoryId:categoryId[slug],title,startAt,endAt:duration(startAt,minutes),status:"COMPLETED",completedAt:duration(startAt,minutes),source:"MANUAL" }; }) });
      const todayOffset = (now.getDay() + 6) % 7;
      const planned = [
        { slug:"rest",title:"Танцевальная практика",start:at(Math.min(todayOffset+1,6),13),minutes:240 },
        { slug:"growth",title:"Урок английского",start:at(todayOffset,18,30),minutes:60 },
      ];
      await prisma.event.createMany({ data: planned.map(item => ({ userId:demoUser.id,categoryId:categoryId[item.slug],title:item.title,startAt:item.start,endAt:duration(item.start,item.minutes),status:"PLANNED",source:"MANUAL" })) });
    }
  }

  console.log(`Seed completed for ${users.length} user(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
