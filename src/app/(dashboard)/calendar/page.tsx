import { redirect } from "next/navigation";

import { CalendarWorkspace } from "@/components/calendar/calendar-workspace";
import { getCurrentUser } from "@/lib/auth";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string | string[]; goalId?: string | string[]; taskId?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const query = await searchParams;
  const create = Array.isArray(query.create) ? query.create[0] : query.create;
  const goalId = Array.isArray(query.goalId) ? query.goalId[0] : query.goalId;
  const taskId = Array.isArray(query.taskId) ? query.taskId[0] : query.taskId;

  return (
    <main className="page-content calendar-page">
      <div className="page-heading">
        <div><span className="eyebrow">Планирование</span><h1>Календарь</h1><p>Время в контексте ваших жизненных сфер.</p></div>
        <div className="date-chip">{user.timeZone}</div>
      </div>
      <CalendarWorkspace
        key={create === "1" ? `create-${goalId ?? ""}-${taskId ?? ""}` : "calendar"}
        timeZone={user.timeZone}
        initialCreate={create === "1"}
        initialGoalId={goalId}
        initialGoalTaskId={taskId}
      />
    </main>
  );
}
