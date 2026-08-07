export function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function calculateGoalProgress(currentValue: number, targetValue: number): number {
  if (!Number.isFinite(currentValue) || !Number.isFinite(targetValue) || targetValue <= 0) {
    return 0;
  }

  return clampPercentage((currentValue / targetValue) * 100);
}
