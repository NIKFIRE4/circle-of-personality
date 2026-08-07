import type { BalanceMetric } from "@/lib/dashboard-math";

/**
 * Turns the week's numbers into a few plain observations and at most one
 * concrete next step.
 *
 * The shape of this module is driven by three findings rather than by what is
 * easy to compute:
 *
 * 1. Kluger & DeNisi's meta-analysis (607 effect sizes) found that over a third
 *    of feedback interventions *reduced* performance, and that effectiveness
 *    falls as feedback moves attention from the task toward the self. So every
 *    string here talks about hours and slots, never about the person: no
 *    grades, no "you are behind", no praise of character.
 *
 * 2. Reviews of self-tracking report guilt, shame and disengagement when missed
 *    targets are presented as personal failure. Lags are therefore capped,
 *    always accompanied by something that went well, and a deliberately empty
 *    area is named as a legitimate choice rather than a miss.
 *
 * 3. Implementation intentions ("if X, then Y") roughly double follow-through
 *    (d = 0.65 across 94 studies). The suggestion is consequently a concrete
 *    when/where plan anchored to a real free day, not "do more of this".
 */

const STRENGTH_VALUE = 70;
const LAG_VALUE = 40;
const MAX_OBSERVATIONS_PER_TONE = 2;
/** Below this, a "lag" is indistinguishable from an area the user simply left alone. */
const UNTOUCHED_VALUE = 5;
const MEANINGFUL_MINUTES = 30;

export type InsightTone = "strength" | "lag" | "untouched" | "trend";

export type InsightObservation = {
  id: string;
  tone: InsightTone;
  headline: string;
  detail: string;
};

export type InsightSuggestion = {
  id: string;
  headline: string;
  detail: string;
};

export type ProgressAnalysis = {
  /** False when the week is too empty to say anything honest about it. */
  hasEnoughData: boolean;
  observations: InsightObservation[];
  suggestion: InsightSuggestion | null;
  summary: string;
};

export type ProgressAnalysisInput = {
  change: number;
  completedMinutes: number;
  metrics: BalanceMetric[];
  weekDays: Array<{ label: string; planned: boolean; value: number }>;
};

export function analyzeProgress(input: ProgressAnalysisInput): ProgressAnalysis {
  const configured = input.metrics.filter((metric) => metric.targetMinutes > 0);

  if (configured.length === 0) {
    return {
      hasEnoughData: false,
      observations: [],
      suggestion: null,
      summary:
        "Ни у одной сферы нет недельной цели. Задайте цель хотя бы одной — тогда здесь появится разбор.",
    };
  }

  if (input.completedMinutes < MEANINGFUL_MINUTES) {
    return {
      hasEnoughData: false,
      observations: [],
      suggestion: null,
      summary:
        "За эту неделю выполненного времени пока почти нет. Отметьте несколько задач — и разбор соберётся сам.",
    };
  }

  const strengths = [...configured]
    .filter((metric) => metric.value >= STRENGTH_VALUE)
    .sort((left, right) => right.value - left.value)
    .slice(0, MAX_OBSERVATIONS_PER_TONE);

  const lags = [...configured]
    .filter(
      (metric) => metric.value < LAG_VALUE && metric.value >= UNTOUCHED_VALUE,
    )
    .sort((left, right) => left.value - right.value)
    .slice(0, MAX_OBSERVATIONS_PER_TONE);

  const untouched = [...configured]
    .filter((metric) => metric.value < UNTOUCHED_VALUE)
    .sort((left, right) => right.targetMinutes - left.targetMinutes)
    .slice(0, MAX_OBSERVATIONS_PER_TONE);

  const observations: InsightObservation[] = [
    ...strengths.map((metric): InsightObservation => ({
      id: `strength:${metric.id}`,
      tone: "strength",
      headline: `${metric.name} — ${formatHours(metric.completedMinutes)} из ${formatHours(metric.targetMinutes)}`,
      detail: metric.value >= 100
        ? "Недельная цель закрыта полностью."
        : `Набрано ${metric.value}% недельной цели — это уже основная часть.`,
    })),
    ...trendObservation(input.change),
    // Lags come after strengths so the section never opens with a deficit.
    ...lags.map((metric): InsightObservation => ({
      id: `lag:${metric.id}`,
      tone: "lag",
      headline: `${metric.name} — ${formatHours(metric.completedMinutes)} из ${formatHours(metric.targetMinutes)}`,
      detail: `До недельной цели осталось ${formatHours(Math.max(0, metric.targetMinutes - metric.completedMinutes))}.`,
    })),
    ...untouched.map((metric): InsightObservation => ({
      id: `untouched:${metric.id}`,
      tone: "untouched",
      headline: `${metric.name} — времени на этой неделе не было`,
      detail:
        "Возможно, неделя была занята другим и это осознанный выбор. Если сфера сейчас не в приоритете, цель можно уменьшить в настройках.",
    })),
  ];

  return {
    hasEnoughData: true,
    observations,
    suggestion: buildSuggestion(lags[0] ?? untouched[0], input.weekDays),
    summary: buildSummary(strengths.length, lags.length + untouched.length),
  };
}

function trendObservation(change: number): InsightObservation[] {
  if (Math.abs(change) < 5) return [];

  return [{
    id: "trend",
    tone: "trend",
    headline: change > 0
      ? `На ${change} п.п. больше, чем неделей раньше`
      : `На ${Math.abs(change)} п.п. меньше, чем неделей раньше`,
    detail: change > 0
      ? "Считается среднее выполнение по сферам с недельной целью."
      : "Недели редко бывают одинаковыми: болезнь, поездка или аврал сдвигают этот показатель без всякой связи с усилиями.",
  }];
}

/**
 * Builds an if-then plan pinned to a real day that currently has nothing
 * scheduled, so the step is concrete rather than an instruction to try harder.
 */
function buildSuggestion(
  target: BalanceMetric | undefined,
  weekDays: ProgressAnalysisInput["weekDays"],
): InsightSuggestion | null {
  if (!target) return null;

  const remaining = Math.max(0, target.targetMinutes - target.completedMinutes);
  const freeDay = weekDays.find((day) => !day.planned);
  // A single session that is a realistic slice of what is left, not the whole gap.
  const slotMinutes = Math.min(90, Math.max(30, Math.round(remaining / 2 / 15) * 15));

  return {
    id: `suggestion:${target.id}`,
    headline: freeDay
      ? `Попробуйте: в ${dayInAccusative(freeDay.label)} — ${formatMinutes(slotMinutes)} на «${target.name}»`
      : `Попробуйте: один слот ${formatMinutes(slotMinutes)} на «${target.name}»`,
    detail: freeDay
      ? `На этот день пока ничего не запланировано. Конкретное «когда» срабатывает заметно чаще, чем намерение «заняться этим на неделе».`
      : `Неделя плотная, поэтому один короткий слот в календаре надёжнее, чем планы наверстать всё сразу.`,
  };
}

function buildSummary(strengthCount: number, behindCount: number): string {
  if (strengthCount > 0 && behindCount === 0) {
    return "Неделя идёт ровно: сферы с целями набирают своё.";
  }
  if (strengthCount === 0 && behindCount > 0) {
    return "Ниже — как распределилось время. Это картина недели, а не оценка вам.";
  }
  if (strengthCount > 0 && behindCount > 0) {
    return "Где-то время набралось, где-то нет — обычная картина живой недели.";
  }
  return "Сферы держатся в середине: ни провалов, ни перекосов.";
}

const DAY_ACCUSATIVE: Record<string, string> = {
  пн: "понедельник",
  вт: "вторник",
  ср: "среду",
  чт: "четверг",
  пт: "пятницу",
  сб: "субботу",
  вс: "воскресенье",
};

function dayInAccusative(label: string): string {
  return DAY_ACCUSATIVE[label.toLowerCase()] ?? label;
}

export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} ч`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} ч`;
}
