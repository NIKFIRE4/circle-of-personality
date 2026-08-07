import type { CSSProperties } from "react";
import { redirect } from "next/navigation";

import { BodyMesh } from "@/components/overview/body-mesh";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardData, type BalanceMetric } from "@/lib/dashboard";

export default async function OverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const dashboard = await getDashboardData(user.id, user.timeZone);
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
        </div>
      </section>
    </main>
  );
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
