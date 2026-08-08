import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BodyMesh } from "@/components/overview/body-mesh";
import { CategoriesCard } from "@/components/settings/categories-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDashboardData, type BalanceMetric } from "@/lib/dashboard";

import styles from "./overview.module.css";

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
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="overview-title">
        <header className={styles.heroHeader}>
          <div className={styles.heroCopy}>
            <span className="eyebrow">Живой профиль недели</span>
            <h1 id="overview-title">Ваш контур <em>сегодня</em></h1>
            <p>Смотрите, каким сферам достаётся ваше время, и мягко возвращайте неделю к нужному ритму.</p>
          </div>
          <dl className={styles.summary}>
            <div>
              <dt>Общий баланс</dt>
              <dd>{dashboard.total}%</dd>
            </div>
            <div>
              <dt>В фокусе</dt>
              <dd>{dashboard.topCategory?.name ?? "Поиск ритма"}</dd>
            </div>
          </dl>
        </header>

        <div className={styles.balanceGrid}>
          <MetricColumn metrics={leftMetrics} side="left" />
          <BodyMesh
            categorySlug={
              dashboard.topCategory?.completedMinutes
                ? dashboard.topCategory.slug
                : null
            }
            preferenceKey={`life-balance:humanoid:${user.id}`}
          />
          <MetricColumn metrics={rightMetrics} side="right" />
        </div>

        {dashboard.unassignedEvents > 0 && (
          <Link className={styles.hint} href="/calendar">
            <span>{formatUnassigned(dashboard.unassignedEvents)} без сферы</span>
            <small>Распределите их в календаре, чтобы они учитывались в балансе</small>
          </Link>
        )}
      </section>

      <section className={styles.settingsSection} aria-label="Настройка сфер обзора">
        <CategoriesCard
          initialCategories={categories}
          title="Сферы обзора"
          description="Управляйте составом сфер и недельными ориентирами. Изменения сразу отражаются в контуре и аналитике."
        />
      </section>
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
    <ul className={`${styles.metricColumn} ${side === "left" ? styles.metricColumnLeft : styles.metricColumnRight}`}>
      {metrics.map((metric) => (
        <Metric key={metric.id} metric={metric} />
      ))}
    </ul>
  );
}

function Metric({ metric }: { metric: BalanceMetric }) {
  const style = { "--metric-color": metric.color } as CSSProperties;
  const timeLabel = metric.targetMinutes
    ? `${formatHours(metric.completedMinutes)} / ${formatHours(metric.targetMinutes)}`
    : "Без недельной цели";

  return (
    <li className={styles.metricCard} style={style}>
      <div className={styles.metricHeading}>
        <span className={styles.metricDot} />
        <span>{metric.name}</span>
        <strong>{metric.value}%</strong>
      </div>
      <div
        aria-label={`${metric.name}: ${metric.value}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={metric.value}
        className={styles.metricProgress}
        role="progressbar"
      >
        <i style={{ width: `${metric.value}%` }} />
      </div>
      <small>{timeLabel}</small>
    </li>
  );
}

function formatHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10} ч`;
}
