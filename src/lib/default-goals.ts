export type DefaultGoalTaskTemplate = {
  title: string;
  description: string;
  kind: "HABIT" | "MILESTONE";
  targetPerWeek: number | null;
  durationMinutes: number;
};

export type DefaultGoalTemplate = {
  categorySlug: string;
  title: string;
  description: string;
  horizonDays: number;
  tasks: readonly DefaultGoalTaskTemplate[];
};

/**
 * Starter goals deliberately describe outcomes, while their steps describe
 * observable behaviour. They are editable examples, not prescriptions.
 */
export const DEFAULT_GOAL_TEMPLATES: readonly DefaultGoalTemplate[] = [
  {
    categorySlug: "health",
    title: "Стать сильнее и выносливее",
    description: "Собрать устойчивый ритм движения без гонки за идеальным планом.",
    horizonDays: 84,
    tasks: [
      { title: "Сделать тренировку дома или в зале", description: "Выполнить простую тренировку на основные группы мышц.", kind: "HABIT", targetPerWeek: 2, durationMinutes: 35 },
      { title: "Погулять быстрым шагом 30 минут", description: "Выйти на прогулку в удобном темпе; при желании заменить её бегом или велосипедом.", kind: "HABIT", targetPerWeek: 3, durationMinutes: 30 },
    ],
  },
  {
    categorySlug: "career",
    title: "Сделать заметный карьерный шаг",
    description: "За двенадцать недель создать результат, который можно показать другим.",
    horizonDays: 84,
    tasks: [
      { title: "50 минут поработать над важной задачей", description: "Выбрать одну рабочую задачу и на это время закрыть почту и мессенджеры.", kind: "HABIT", targetPerWeek: 3, durationMinutes: 50 },
      { title: "Попросить обратную связь по своей работе", description: "Показать результат коллеге или руководителю и спросить, что можно улучшить.", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 30 },
    ],
  },
  {
    categorySlug: "relationships",
    title: "Стать ближе к важным людям",
    description: "Не ждать повода, а регулярно создавать время для настоящего контакта.",
    horizonDays: 56,
    tasks: [
      { title: "Позвонить близкому человеку и поговорить", description: "Узнать, как у него дела, и спокойно поговорить без параллельных занятий.", kind: "HABIT", targetPerWeek: 2, durationMinutes: 30 },
      { title: "Сходить в кафе или на прогулку с друзьями", description: "Договориться о встрече и провести время вместе без спешки.", kind: "HABIT", targetPerWeek: 1, durationMinutes: 90 },
    ],
  },
  {
    categorySlug: "growth",
    title: "Освоить новый навык через практику",
    description: "Заменить бесконечное потребление материалов короткими циклами практики и обратной связи.",
    horizonDays: 84,
    tasks: [
      { title: "25 минут заниматься выбранным навыком", description: "Например, пройти упражнение по английскому, рисованию или программированию.", kind: "HABIT", targetPerWeek: 4, durationMinutes: 25 },
      { title: "Сделать небольшую работу с новым навыком", description: "Написать текст, нарисовать иллюстрацию, собрать программу или создать другой понятный результат.", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 120 },
    ],
  },
  {
    categorySlug: "finance",
    title: "Создать финансовую подушку",
    description: "Сначала понять реальную сумму базовых расходов, затем сделать накопление регулярным.",
    horizonDays: 90,
    tasks: [
      { title: "Записать траты за неделю", description: "Посмотреть историю операций и распределить расходы по основным категориям.", kind: "HABIT", targetPerWeek: 1, durationMinutes: 25 },
      { title: "Посчитать обязательные расходы за месяц", description: "Сложить жильё, продукты, транспорт, связь, кредиты и другие регулярные платежи.", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 45 },
    ],
  },
  {
    categorySlug: "rest",
    title: "Восстанавливаться до истощения",
    description: "Поставить отдых в календарь заранее и проверить, какие форматы действительно возвращают энергию.",
    horizonDays: 42,
    tasks: [
      { title: "Погулять 30 минут без рабочих звонков", description: "Убрать телефон в карман и пройтись по улице или парку.", kind: "HABIT", targetPerWeek: 3, durationMinutes: 30 },
      { title: "Провести вечер без работы", description: "Посмотреть фильм, почитать, поиграть, принять ванну или выбрать другой спокойный отдых.", kind: "HABIT", targetPerWeek: 1, durationMinutes: 120 },
    ],
  },
  {
    categorySlug: "creativity",
    title: "Завершить маленький творческий проект",
    description: "Снизить масштаб настолько, чтобы работу можно было закончить и показать.",
    horizonDays: 56,
    tasks: [
      { title: "45 минут заниматься творчеством", description: "Рисовать, писать, фотографировать, играть на инструменте или собирать материал.", kind: "HABIT", targetPerWeek: 2, durationMinutes: 45 },
      { title: "Закончить и показать одну работу", description: "Выбрать небольшой результат, завершить его и отправить другу или опубликовать.", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 20 },
    ],
  },
  {
    categorySlug: "environment",
    title: "Сделать пространство легче",
    description: "Убрать повторяющееся бытовое трение вместо редкого генерального рывка.",
    horizonDays: 42,
    tasks: [
      { title: "Сделать уборку по дому", description: "Разложить вещи по местам, протереть пыль, пропылесосить или помыть пол.", kind: "HABIT", targetPerWeek: 1, durationMinutes: 35 },
      { title: "Разобрать одну полку, ящик или шкаф", description: "Выбросить ненужное и удобно разложить оставшиеся вещи.", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 60 },
    ],
  },
];

export const GOAL_METHOD_SOURCES = [
  {
    title: "Locke & Latham — Goal-setting theory",
    detail: "Конкретные достаточно сложные цели работают лучше расплывчатого «сделать всё возможное», особенно при наличии обратной связи.",
    url: "https://www.psychologicalscience.org/journals/current-directions/j.1467-8721.2006.00449.x",
  },
  {
    title: "Gollwitzer & Sheeran — implementation intentions",
    detail: "План, заранее связывающий ситуацию и действие, помогает переводить намерение в поведение — поэтому шаги получают частоту и место в календаре.",
    url: "https://www.socmot.uni-konstanz.de/publications/implementation-intentions-and-goal-achievement-meta-analysis-effects-and-processes",
  },
  {
    title: "ВОЗ — физическая активность",
    detail: "Стартовый пример здоровья сочетает аэробную и силовую нагрузку; пользователь может снизить объём под своё состояние.",
    url: "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
  },
] as const;

export function targetDateFromHorizon(horizonDays: number, from = new Date()): Date {
  const target = new Date(from);
  target.setUTCDate(target.getUTCDate() + horizonDays);
  target.setUTCHours(12, 0, 0, 0);
  return target;
}
