/**
 * The simulated clock: real mission durations in real seconds (no speed-up factor — the design's
 * "real durations clock"). A day of play is bounded by a budget of hours per day plus the time a
 * human spends deciding and clicking, so "day 12" means twelve play days, not twelve midnights.
 */

/** Assumed human decision/overhead time charged once per action (menus, reading the board). */
export const DEFAULT_HUMAN_PAUSE_SECONDS = 30;
/** How many hours of the simulated clock count as one day of play. */
export const DEFAULT_HOURS_PER_DAY = 2;

const SECONDS_PER_HOUR = 3600;

export interface Clock {
  /** Seconds elapsed since the run started. */
  now(): number;
  /** Move the clock forward. Negative steps are a bug, not a feature. */
  advance(seconds: number): void;
}

/** The play-time budget that turns simulated seconds into days of play. */
export interface PlayTimeBudget {
  readonly hoursPerDay: number;
  readonly humanPauseSeconds: number;
}

export const DEFAULT_BUDGET: PlayTimeBudget = {
  hoursPerDay: DEFAULT_HOURS_PER_DAY,
  humanPauseSeconds: DEFAULT_HUMAN_PAUSE_SECONDS,
};

export function createClock(startSeconds = 0): Clock {
  let elapsed = startSeconds;
  return {
    now(): number {
      return elapsed;
    },
    advance(seconds: number): void {
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error(`clock can only move forward, got ${seconds}`);
      }
      elapsed += seconds;
    },
  };
}

/** Simulated seconds → days of play at the budget's hours-per-day (fractional, like the game's clock). */
export function calendarDays(totalSeconds: number, budget: PlayTimeBudget = DEFAULT_BUDGET): number {
  return totalSeconds / (budget.hoursPerDay * SECONDS_PER_HOUR);
}
