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
  const configuredMetrics = dashboard.metrics.filter(
    (metric) => metric.targetMinutes > 0,
  );
  const values = configuredMetrics.map((metric) => metric.value);
  const spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
  const focus = dashboard.topCategory;

  return (
    <main className={styles.page}>
      <header className={styles.overviewHeader}>
        <div>
          <span className="eyebrow">Живой профиль недели</span>
          <h1 id="overview-title">Ваш контур сегодня</h1>
        </div>
        <p>
          Смотрите, каким сферам достаётся ваше время, и мягко возвращайте
          неделю к нужному ритму.
        </p>
      </header>

      <section
        aria-labelledby="overview-title"
        aria-label="Общий баланс недели"
        className={styles.stage}
      >
        <div className={styles.summaryBlock}>
          <span>Общий баланс</span>
          <strong className={styles.balanceScore}>
            {dashboard.total}<small>%</small>
          </strong>
          <p>
            {configuredMetrics.length
              ? `Неделя собрана в видимый ритм. Разрыв между самой сильной и тихой сферой — ${spread} ${formatPoints(spread)}.`
              : "Добавьте недельные ориентиры, чтобы увидеть ритм сфер."}
          </p>
          {dashboard.unassignedEvents > 0 ? (
            <Link className={styles.syncLink} href="/calendar">
              {formatUnassigned(dashboard.unassignedEvents)} ждут сферы
            </Link>
          ) : (
            <span className={styles.syncStatus}>Все события распределены</span>
          )}
        </div>

        <div className={styles.figureZone}>
          <BodyMesh
            categorySlug={
              focus?.completedMinutes ? focus.slug : null
            }
            preferenceKey={`life-balance:humanoid:${user.id}`}
          />
        </div>

        <div className={styles.focusBlock}>
          <span>В фокусе</span>
          <strong>{focus?.name ?? "Поиск ритма"}</strong>
          {focus ? (
            <>
              <small>
                {formatDuration(focus.completedMinutes)} из {formatDuration(focus.targetMinutes)}
              </small>
              <p>
                {focus.value}% недельного ориентира. Это самая наполненная
                сфера прямо сейчас.
              </p>
              <Link href="/calendar?create=1">Добавить задачу в сферу</Link>
            </>
          ) : (
            <p>Запланируйте время — и здесь появится текущая ведущая сфера.</p>
          )}
        </div>
      </section>

      <section className={styles.spheres} aria-labelledby="spheres-title">
        <header className={styles.sectionHead}>
          <h2 id="spheres-title">Сферы недели</h2>
          <p>
            Фактическое время относительно недельного ориентира. Без рейтинга —
            только видимый ритм.
          </p>
        </header>
        <SphereMetricList metrics={dashboard.metrics} />
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

function SphereMetricList({ metrics }: { metrics: BalanceMetric[] }) {
  return (
    <ul className={styles.sphereList}>
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
    <li className={styles.sphereRow} style={style}>
      <div className={styles.sphereName}>
        <span className={styles.sphereDot} />
        <span>{metric.name}</span>
      </div>
      <div
        aria-label={`${metric.name}: ${metric.value}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={metric.value}
        className={styles.sphereProgress}
        role="progressbar"
      >
        <i style={{ width: `${metric.value}%` }} />
      </div>
      <small className={styles.sphereHours}>{timeLabel}</small>
      <strong className={styles.sphereScore}>{metric.value}%</strong>
    </li>
  );
}

function formatHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10} ч`;
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (!rest) return `${hours} ч`;
  if (!hours) return `${rest} мин`;
  return `${hours} ч ${rest} мин`;
}

function formatPoints(value: number): string {
  const rules = new Intl.PluralRules("ru-RU");
  const form = rules.select(value);

  if (form === "one") return "пункт";
  if (form === "few") return "пункта";
  return "пунктов";
}
