const DAYS_PER_WEEK = 7;
const MONDAY_OFFSET = 6;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
// The game's day and week follow Brazil time (UTC-3, no daylight saving): the owner's pilots live there.
const GAME_UTC_OFFSET_HOURS = -3;
const GAME_OFFSET_MS = GAME_UTC_OFFSET_HOURS * MS_PER_HOUR;

/** The game calendar day `now` falls in (UTC-3), as a date at 00:00 UTC: what the day columns store. */
export function gameDayOf(now: Date): Date {
  const local = new Date(now.getTime() + GAME_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** The Monday (game calendar date, 00:00 UTC) of the week `now` falls in: compared with the day columns. */
export function weekStartOf(now: Date): Date {
  const day = gameDayOf(now);
  const sinceMonday = (day.getUTCDay() + MONDAY_OFFSET) % DAYS_PER_WEEK;
  return new Date(day.getTime() - sinceMonday * MS_PER_DAY);
}

/** The instant a game week starts: Monday 00:00 in Brazil time (03:00 UTC), for showing the window. */
export function weekStartInstant(weekStart: Date): Date {
  return new Date(weekStart.getTime() - GAME_OFFSET_MS);
}
