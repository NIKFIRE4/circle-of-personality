-- Lets a task opt out of the balance wheel (e.g. one-off errands that
-- shouldn't skew a sphere's weekly percentage). Defaults to true so every
-- existing event keeps counting exactly as it did before this column existed.
ALTER TABLE "Event"
ADD COLUMN "includeInBalance" BOOLEAN NOT NULL DEFAULT true;
