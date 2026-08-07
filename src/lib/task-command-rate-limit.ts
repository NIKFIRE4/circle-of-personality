import { ApiError } from "./api";

type RateBucket = {
  count: number;
  windowStartedAt: number;
};

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const globalWithTaskCommandLimits = globalThis as typeof globalThis & {
  taskCommandRateBuckets?: Map<string, RateBucket>;
};
const buckets = globalWithTaskCommandLimits.taskCommandRateBuckets
  ?? new Map<string, RateBucket>();

globalWithTaskCommandLimits.taskCommandRateBuckets = buckets;

/** Lightweight per-instance protection. Distributed deployments should back
 * this with Redis or an API-gateway limiter as well. */
export function assertTaskCommandRateLimit(userId: string, now = Date.now()): void {
  const existing = buckets.get(userId);
  if (!existing || now - existing.windowStartedAt >= WINDOW_MS) {
    buckets.set(userId, { count: 1, windowStartedAt: now });
    pruneExpiredBuckets(now);
    return;
  }

  if (existing.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.windowStartedAt + WINDOW_MS - now) / 1_000),
    );
    throw new ApiError(
      429,
      "TASK_COMMAND_RATE_LIMITED",
      `Слишком много запросов. Повторите через ${retryAfterSeconds} сек.`,
      { retryAfterSeconds },
    );
  }

  existing.count += 1;
}

function pruneExpiredBuckets(now: number): void {
  if (buckets.size < 1_000) return;
  for (const [userId, bucket] of buckets) {
    if (now - bucket.windowStartedAt >= WINDOW_MS) buckets.delete(userId);
  }
}
