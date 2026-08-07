-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "unit" VARCHAR(32) NOT NULL DEFAULT '',
    "currentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "targetDate" TIMESTAMP(3),
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleCalendarConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" VARCHAR(512) NOT NULL,
    "clientSecretEncrypted" TEXT NOT NULL,
    "redirectUri" VARCHAR(2048),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_userId_status_targetDate_idx" ON "Goal"("userId", "status", "targetDate");

-- CreateIndex
CREATE INDEX "Goal_categoryId_idx" ON "Goal"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarConfig_userId_key" ON "GoogleCalendarConfig"("userId");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BalanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleCalendarConfig" ADD CONSTRAINT "GoogleCalendarConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraints
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_currentValue_nonnegative" CHECK ("currentValue" >= 0);
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_targetValue_positive" CHECK ("targetValue" > 0);
ALTER TABLE "BalanceCategory" ADD CONSTRAINT "BalanceCategory_targetMinutesPerWeek_nonnegative" CHECK ("targetMinutesPerWeek" >= 0);
ALTER TABLE "Event" ADD CONSTRAINT "Event_time_range_valid" CHECK ("endAt" > "startAt");
