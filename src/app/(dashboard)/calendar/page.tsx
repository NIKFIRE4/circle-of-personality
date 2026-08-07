import { redirect } from "next/navigation";

import { CalendarWorkspace } from "@/components/calendar/calendar-workspace";
import { getCurrentUser } from "@/lib/auth";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const query = await searchParams;
  const create = Array.isArray(query.create) ? query.create[0] : query.create;

  return (
    <main className="page-content calendar-page">
      <div className="page-heading">
        <div><span className="eyebrow">Планирование</span><h1>Календарь</h1><p>Время в контексте ваших жизненных сфер.</p></div>
        <div className="date-chip">{user.timeZone}</div>
      </div>
      <CalendarWorkspace key={create === "1" ? "create" : "calendar"} timeZone={user.timeZone} initialCreate={create === "1"} />
    </main>
  );
}
