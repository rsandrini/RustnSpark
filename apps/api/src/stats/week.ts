const DAYS_PER_WEEK = 7;
const MONDAY_OFFSET = 6;
const MS_PER_DAY = 86_400_000;

/** Monday 00:00 UTC of the week `now` falls in: the start of the weekly ranking window. */
export function weekStartOf(now: Date): Date {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (now.getUTCDay() + MONDAY_OFFSET) % DAYS_PER_WEEK;
  return new Date(midnight - sinceMonday * MS_PER_DAY);
}
