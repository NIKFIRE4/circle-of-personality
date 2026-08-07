-- Add Apple/iCloud as an external calendar source while keeping the existing
-- Google OAuth connection format backwards-compatible.
ALTER TYPE "EventSource" ADD VALUE 'APPLE';
ALTER TYPE "CalendarProvider" ADD VALUE 'APPLE';

-- iCal URLs are bearer credentials and therefore live in an encrypted TEXT
-- column. Conditional request metadata lets refreshes avoid needless parsing.
ALTER TABLE "CalendarConnection"
ADD COLUMN "displayName" VARCHAR(200),
ADD COLUMN "feedUrlEncrypted" TEXT,
ADD COLUMN "feedEtag" VARCHAR(512),
ADD COLUMN "feedLastModified" VARCHAR(512),
ADD COLUMN "feedContentHash" VARCHAR(64);
