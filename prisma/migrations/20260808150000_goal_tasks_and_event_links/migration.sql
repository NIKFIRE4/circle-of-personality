-- Goal steps are durable definitions (weekly habits or one-off milestones).
-- Calendar events remain the individual, schedulable pieces of work.
CREATE TYPE "GoalTaskKind" AS ENUM ('HABIT', 'MILESTONE');
CREATE TYPE "GoalTaskStatus" AS ENUM ('ACTIVE', 'COMPLETED');

ALTER TYPE "EventSource" ADD VALUE 'GOAL';

CREATE TABLE "GoalTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "kind" "GoalTaskKind" NOT NULL DEFAULT 'HABIT',
    "targetPerWeek" INTEGER,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "status" "GoalTaskStatus" NOT NULL DEFAULT 'ACTIVE',
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GoalTask_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Event"
ADD COLUMN "goalId" TEXT,
ADD COLUMN "goalTaskId" TEXT;

CREATE INDEX "GoalTask_userId_status_idx" ON "GoalTask"("userId", "status");
CREATE INDEX "GoalTask_goalId_sortOrder_idx" ON "GoalTask"("goalId", "sortOrder");
CREATE INDEX "Event_goalId_startAt_idx" ON "Event"("goalId", "startAt");
CREATE INDEX "Event_goalTaskId_status_startAt_idx" ON "Event"("goalTaskId", "status", "startAt");

ALTER TABLE "GoalTask" ADD CONSTRAINT "GoalTask_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoalTask" ADD CONSTRAINT "GoalTask_goalId_fkey"
FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_goalId_fkey"
FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_goalTaskId_fkey"
FOREIGN KEY ("goalTaskId") REFERENCES "GoalTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing accounts with an empty Goals section receive the same editable
-- starter set as newly registered accounts. Accounts with any goals are left
-- untouched.
WITH templates(slug, title, description, horizon_days) AS (
  VALUES
    ('health', 'Стать сильнее и выносливее', 'Собрать устойчивый ритм движения без гонки за идеальным планом.', 84),
    ('career', 'Сделать заметный карьерный шаг', 'За двенадцать недель создать результат, который можно показать другим.', 84),
    ('relationships', 'Стать ближе к важным людям', 'Не ждать повода, а регулярно создавать время для настоящего контакта.', 56),
    ('growth', 'Освоить новый навык через практику', 'Заменить бесконечное потребление материалов короткими циклами практики и обратной связи.', 84),
    ('finance', 'Создать финансовую подушку', 'Сначала понять реальную сумму базовых расходов, затем сделать накопление регулярным.', 90),
    ('rest', 'Восстанавливаться до истощения', 'Поставить отдых в календарь заранее и проверить, какие форматы действительно возвращают энергию.', 42),
    ('creativity', 'Завершить маленький творческий проект', 'Снизить масштаб настолько, чтобы работу можно было закончить и показать.', 56),
    ('environment', 'Сделать пространство легче', 'Убрать повторяющееся бытовое трение вместо редкого генерального рывка.', 42)
)
INSERT INTO "Goal" ("id", "userId", "categoryId", "title", "description", "unit", "currentValue", "targetValue", "targetDate", "status", "createdAt", "updatedAt")
SELECT
  'starter_goal_' || substr(md5(u."id" || ':' || t.slug), 1, 24),
  u."id",
  c."id",
  t.title,
  t.description,
  'результат',
  0,
  1,
  CURRENT_TIMESTAMP + (t.horizon_days * INTERVAL '1 day'),
  'ACTIVE'::"GoalStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u, templates t, "BalanceCategory" c
WHERE c."userId" = u."id"
  AND c."slug" = t.slug
  AND NOT EXISTS (SELECT 1 FROM "Goal" existing WHERE existing."userId" = u."id");

WITH task_templates(slug, sort_order, title, description, kind, target_per_week, duration_minutes) AS (
  VALUES
    ('health', 0, 'Силовая тренировка на всё тело', 'Комфортная нагрузка с постепенным усложнением.', 'HABIT'::"GoalTaskKind", 2, 35),
    ('health', 1, 'Быстрая ходьба, бег или велосипед', 'Выберите интенсивность, на которой можете сохранять регулярность.', 'HABIT'::"GoalTaskKind", 3, 30),
    ('career', 0, 'Фокус-сессия над главным проектом', 'Один заранее выбранный результат без почты и мессенджеров.', 'HABIT'::"GoalTaskKind", 3, 50),
    ('career', 1, 'Запросить конкретную обратную связь', 'У коллеги, руководителя, клиента или наставника.', 'MILESTONE'::"GoalTaskKind", NULL::INTEGER, 30),
    ('relationships', 0, 'Разговор без параллельных дел', 'Позвонить или встретиться и внимательно слушать.', 'HABIT'::"GoalTaskKind", 2, 30),
    ('relationships', 1, 'Совместное время без телефонов', 'Прогулка, ужин, игра или маленькая поездка.', 'HABIT'::"GoalTaskKind", 1, 90),
    ('growth', 0, 'Сфокусированная практика навыка', 'Одна конкретная техника или упражнение за подход.', 'HABIT'::"GoalTaskKind", 4, 25),
    ('growth', 1, 'Сделать маленький итоговый проект', 'Артефакт, по которому видно, чему вы научились.', 'MILESTONE'::"GoalTaskKind", NULL::INTEGER, 120),
    ('finance', 0, 'Еженедельный обзор денег', 'Проверить траты, обязательные платежи и ближайшие решения.', 'HABIT'::"GoalTaskKind", 1, 25),
    ('finance', 1, 'Посчитать месяц обязательных расходов', 'Зафиксировать ориентир для первого уровня подушки.', 'MILESTONE'::"GoalTaskKind", NULL::INTEGER, 45),
    ('rest', 0, 'Прогулка без ленты и рабочих звонков', 'Оставить внимание телу и окружающему пространству.', 'HABIT'::"GoalTaskKind", 3, 30),
    ('rest', 1, 'Вечер без работы', 'Заранее выбрать занятие, после которого легче, а не тяжелее.', 'HABIT'::"GoalTaskKind", 1, 120),
    ('creativity', 0, 'Творческая сессия без оценки результата', 'Рисовать, писать, снимать, играть или собирать материал.', 'HABIT'::"GoalTaskKind", 2, 45),
    ('creativity', 1, 'Показать готовую работу одному человеку', 'Завершение важнее идеальной полировки.', 'MILESTONE'::"GoalTaskKind", NULL::INTEGER, 20),
    ('environment', 0, 'Короткий еженедельный reset дома', 'Вернуть вещи на места и подготовить пространство к новой неделе.', 'HABIT'::"GoalTaskKind", 1, 35),
    ('environment', 1, 'Устранить одну бытовую помеху', 'Починить, убрать, организовать или автоматизировать то, что раздражает чаще всего.', 'MILESTONE'::"GoalTaskKind", NULL::INTEGER, 60)
)
INSERT INTO "GoalTask" ("id", "userId", "goalId", "title", "description", "kind", "targetPerWeek", "durationMinutes", "status", "sortOrder", "createdAt", "updatedAt")
SELECT
  'starter_task_' || substr(md5(u."id" || ':' || t.slug || ':' || t.sort_order::TEXT), 1, 24),
  u."id",
  g."id",
  t.title,
  t.description,
  t.kind,
  t.target_per_week,
  t.duration_minutes,
  'ACTIVE'::"GoalTaskStatus",
  t.sort_order,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u, task_templates t, "Goal" g
WHERE g."id" = 'starter_goal_' || substr(md5(u."id" || ':' || t.slug), 1, 24)
  AND NOT EXISTS (SELECT 1 FROM "GoalTask" existing WHERE existing."goalId" = g."id");
