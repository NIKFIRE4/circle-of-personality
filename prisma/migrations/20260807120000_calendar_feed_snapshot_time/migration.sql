-- Conditional requests avoid unnecessary parsing, but recurring events still
-- need a periodic full expansion as the three-year import window moves.
ALTER TABLE "CalendarConnection"
ADD COLUMN "feedSnapshotAt" TIMESTAMP(3);
