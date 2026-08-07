import { redirect } from "next/navigation";

import { CalendarFeedCard } from "@/components/settings/calendar-feed-card";
import { CategoriesCard } from "@/components/settings/categories-card";
import { ProfileSettingsCard } from "@/components/settings/profile-settings-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function SettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const categories = await prisma.balanceCategory.findMany({
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
  });

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Ваше пространство</span>
          <h1>Настройки</h1>
          <p>Профиль, сферы жизни и подключённые календари — без технических деталей.</p>
        </div>
      </div>

      <section className="settings-grid">
        <article className="panel settings-card">
          <h2>Профиль и время</h2>
          <p>Часовой пояс влияет на календарь, обзор недели и голосовое создание задач.</p>
          <ProfileSettingsCard
            initialName={user.name}
            email={user.email}
            initialTimeZone={user.timeZone}
          />
        </article>

        <CategoriesCard initialCategories={categories} />
        <CalendarFeedCard />
      </section>
    </main>
  );
}
