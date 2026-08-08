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
      { title: "Силовая тренировка на всё тело", description: "Комфортная нагрузка с постепенным усложнением.", kind: "HABIT", targetPerWeek: 2, durationMinutes: 35 },
      { title: "Быстрая ходьба, бег или велосипед", description: "Выберите интенсивность, на которой можете сохранять регулярность.", kind: "HABIT", targetPerWeek: 3, durationMinutes: 30 },
    ],
  },
  {
    categorySlug: "career",
    title: "Сделать заметный карьерный шаг",
    description: "За двенадцать недель создать результат, который можно показать другим.",
    horizonDays: 84,
    tasks: [
      { title: "Фокус-сессия над главным проектом", description: "Один заранее выбранный результат без почты и мессенджеров.", kind: "HABIT", targetPerWeek: 3, durationMinutes: 50 },
      { title: "Запросить конкретную обратную связь", description: "У коллеги, руководителя, клиента или наставника.", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 30 },
    ],
  },
  {
    categorySlug: "relationships",
    title: "Стать ближе к важным людям",
    description: "Не ждать повода, а регулярно создавать время для настоящего контакта.",
    horizonDays: 56,
    tasks: [
      { title: "Разговор без параллельных дел", description: "Позвонить или встретиться и внимательно слушать.", kind: "HABIT", targetPerWeek: 2, durationMinutes: 30 },
      { title: "Совместное время без телефонов", description: "Прогулка, ужин, игра или маленькая поездка.", kind: "HABIT", targetPerWeek: 1, durationMinutes: 90 },
    ],
  },
  {
    categorySlug: "growth",
    title: "Освоить новый навык через практику",
    description: "Заменить бесконечное потребление материалов короткими циклами практики и обратной связи.",
    horizonDays: 84,
    tasks: [
      { title: "Сфокусированная практика навыка", description: "Одна конкретная техника или упражнение за подход.", kind: "HABIT", targetPerWeek: 4, durationMinutes: 25 },
      { title: "Сделать маленький итоговый проект", description: "Артефакт, по которому видно, чему вы научились.", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 120 },
    ],
  },
  {
    categorySlug: "finance",
    title: "Создать финансовую подушку",
    description: "Сначала понять реальную сумму базовых расходов, затем сделать накопление регулярным.",
    horizonDays: 90,
    tasks: [
      { title: "Еженедельный обзор денег", description: "Проверить траты, обязательные платежи и ближайшие решения.", kind: "HABIT", targetPerWeek: 1, durationMinutes: 25 },
      { title: "Посчитать месяц обязательных расходов", description: "Зафиксировать ориентир для первого уровня подушки.", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 45 },
    ],
  },
  {
    categorySlug: "rest",
    title: "Восстанавливаться до истощения",
    description: "Поставить отдых в календарь заранее и проверить, какие форматы действительно возвращают энергию.",
    horizonDays: 42,
    tasks: [
      { title: "Прогулка без ленты и рабочих звонков", description: "Оставить внимание телу и окружающему пространству.", kind: "HABIT", targetPerWeek: 3, durationMinutes: 30 },
      { title: "Вечер без работы", description: "Заранее выбрать занятие, после которого легче, а не тяжелее.", kind: "HABIT", targetPerWeek: 1, durationMinutes: 120 },
    ],
  },
  {
    categorySlug: "creativity",
    title: "Завершить маленький творческий проект",
    description: "Снизить масштаб настолько, чтобы работу можно было закончить и показать.",
    horizonDays: 56,
    tasks: [
      { title: "Творческая сессия без оценки результата", description: "Рисовать, писать, снимать, играть или собирать материал.", kind: "HABIT", targetPerWeek: 2, durationMinutes: 45 },
      { title: "Показать готовую работу одному человеку", description: "Завершение важнее идеальной полировки.", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 20 },
    ],
  },
  {
    categorySlug: "environment",
    title: "Сделать пространство легче",
    description: "Убрать повторяющееся бытовое трение вместо редкого генерального рывка.",
    horizonDays: 42,
    tasks: [
      { title: "Короткий еженедельный reset дома", description: "Вернуть вещи на места и подготовить пространство к новой неделе.", kind: "HABIT", targetPerWeek: 1, durationMinutes: 35 },
      { title: "Устранить одну бытовую помеху", description: "Починить, убрать, организовать или автоматизировать то, что раздражает чаще всего.", kind: "MILESTONE", targetPerWeek: null, durationMinutes: 60 },
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
