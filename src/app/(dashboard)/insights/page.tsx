import { ArrowDownRight, ArrowUpRight, Clock3, Sparkles, Target } from "lucide-react";
import { redirect } from "next/navigation";

import { TrendChart } from "@/components/insights/trend-chart";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard";

export default async function InsightsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const dashboard = await getDashboardData(user.id, user.timeZone);
  const change = dashboard.change;
  const ChangeIcon = change >= 0 ? ArrowUpRight : ArrowDownRight;
  const range = formatRange(
    new Date(dashboard.weekStartAt),
    new Date(dashboard.weekEndAt),
    user.timeZone,
  );
  const trend = dashboard.weekDays.map((day) => ({
    label: day.label,
    value: day.value,
  }));

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Наблюдения</span>
          <h1>Аналитика</h1>
          <p>Не оценки, а факты о выполненных задачах и времени.</p>
        </div>
        <div className="date-chip">{range}</div>
      </div>
      <section className="insights-grid">
        <article className="panel insight-large">
          <div className="panel-head" style={{ padding: 0 }}>
            <div>
              <span className="panel-title">Выполнение по дням</span>
              <span className="panel-caption">Выполненное время от запланированного</span>
            </div>
            <span className="eyebrow"><ChangeIcon size={12} /> {change >= 0 ? "+" : ""}{change} п.п.</span>
          </div>
          <div className="trend-chart"><TrendChart data={trend} /></div>
        </article>
        <div>
          <article className="panel insight-stat">
            <Target size={17} color="#d8a84f" />
            <div style={{ marginTop: 18 }}><strong>{dashboard.total}%</strong><span>средний прогресс сфер</span></div>
            <p>{change === 0 ? "Без изменений к прошлой неделе" : `${Math.abs(change)} п.п. ${change > 0 ? "выше" : "ниже"} прошлой недели`}</p>
          </article>
          <article className="panel insight-stat">
            <Clock3 size={17} color="#f16f35" />
            <div style={{ marginTop: 18 }}><strong>{formatHours(dashboard.completedMinutes)}</strong><span>выполнено</span></div>
            <p>{dashboard.topCategory?.completedMinutes ? `Больше всего времени: ${dashboard.topCategory.name}` : "Завершённые задачи пока не отмечены"}</p>
          </article>
        </div>
      </section>
      <article className="panel" style={{ padding: 22, marginTop: 16, display: "flex", gap: 16, alignItems: "center" }}>
        <div className="streak-icon"><Sparkles size={20} /></div>
        <div>
          <span className="eyebrow">Наблюдение недели</span>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#b9b4aa" }}>
            {dashboard.topCategory?.completedMinutes
              ? `${dashboard.topCategory.name}: ${formatHours(dashboard.topCategory.completedMinutes)} выполненного времени из ${formatHours(dashboard.topCategory.targetMinutes)} цели.`
              : "Отмечайте задачи выполненными — здесь появится наблюдение на основе ваших данных."}
          </p>
        </div>
      </article>
    </main>
  );
}

function formatHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10} ч`;
}

function formatRange(start: Date, exclusiveEnd: Date, timeZone: string): string {
  const end = new Date(exclusiveEnd.getTime() - 1);
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    timeZone,
  });
  return `${formatter.format(start)} — ${formatter.format(end)}`;
}
