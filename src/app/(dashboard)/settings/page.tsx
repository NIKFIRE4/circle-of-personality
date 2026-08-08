import Link from "next/link";
import { redirect } from "next/navigation";

import { CalendarFeedCard } from "@/components/settings/calendar-feed-card";
import { ProfileSettingsCard } from "@/components/settings/profile-settings-card";
import { getCurrentUser } from "@/lib/auth";

export default async function SettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Ваше пространство</span>
          <h1>Настройки</h1>
          <p>Профиль и подключённые календари — без технических деталей. Сферы жизни настраиваются в <Link href="/overview">обзоре</Link>.</p>
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

        <CalendarFeedCard />
      </section>
    </main>
  );
}
