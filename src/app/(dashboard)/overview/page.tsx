import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BodyMesh } from "@/components/overview/body-mesh";
import { CategoriesCard } from "@/components/settings/categories-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDashboardData, type BalanceMetric } from "@/lib/dashboard";

export default async function OverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [dashboard, categories] = await Promise.all([
    getDashboardData(user.id, user.timeZone),
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
  const leftMetrics = dashboard.metrics.filter((_, index) => index % 2 === 0);
  const rightMetrics = dashboard.metrics.filter((_, index) => index % 2 === 1);

  return (
    <main className="page-content overview-focus-page">
      <section className="panel human-panel human-panel-full">
        <div className="human-stage">
          <div className="human-ring" />
          <BodyMesh
            categorySlug={
              dashboard.topCategory?.completedMinutes
                ? dashboard.topCategory.slug
                : null
            }
            preferenceKey={`life-balance:humanoid:${user.id}`}
          />
          <MetricColumn metrics={leftMetrics} side="left" />
          <MetricColumn metrics={rightMetrics} side="right" />
          {dashboard.unassignedEvents > 0 && (
            <Link className="overview-hint" href="/calendar">
              {formatUnassigned(dashboard.unassignedEvents)} на этой неделе без
              сферы — они не попадают в проценты. Откройте календарь, чтобы
              распределить.
            </Link>
          )}
        </div>
      </section>

      <div style={{ marginTop: 24 }}>
        <CategoriesCard
          initialCategories={categories}
          title="Сферы обзора"
          description="Единственное место, где меняется состав сфер: добавляйте, переименовывайте или убирайте их отсюда. В «Целях» они закреплены как заголовки."
        />
      </div>
    </main>
  );
}

/**
 * Imported events keep their own grammar: 1 событие, 2 события, 5 событий.
 */
function formatUnassigned(count: number): string {
  const rules = new Intl.PluralRules("ru-RU");
  const noun = { one: "событие", few: "события", many: "событий" }[
    rules.select(count) as "one" | "few" | "many"
  ] ?? "событий";

  return `${count} ${noun}`;
}

function MetricColumn({
  metrics,
  side,
}: {
  metrics: BalanceMetric[];
  side: "left" | "right";
}) {
  return (
    <div className={`metric-column metric-column-${side}`}>
      {metrics.map((metric) => (
        <Metric key={metric.id} metric={metric} />
      ))}
    </div>
  );
}

function Metric({ metric }: { metric: BalanceMetric }) {
  const style = { "--metric-color": metric.color } as CSSProperties;
  const timeLabel = metric.targetMinutes
    ? `${formatHours(metric.completedMinutes)} / ${formatHours(metric.targetMinutes)}`
    : "Без недельной цели";

  return (
    <div className="metric-badge" style={style}>
      <div className="metric-heading">
        <span className="metric-dot" />
        <span>{metric.name}</span>
        <strong>{metric.value}%</strong>
      </div>
      <div className="metric-progress">
        <i style={{ width: `${metric.value}%` }} />
      </div>
      <small>{timeLabel}</small>
      <i aria-hidden="true" className="metric-connector" />
    </div>
  );
}

function formatHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10} ч`;
}
