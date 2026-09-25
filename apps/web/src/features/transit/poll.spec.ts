import { describe, it, expect } from 'vitest';
import {
  NEAR_ARRIVAL_MS,
  POLL_FAR_MS,
  POLL_IDLE_MS,
  POLL_NEAR_MS,
  transitPollInterval,
} from './poll';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const inTransit = (arrivalInMs: number) => [
  { status: 'IN_TRANSIT' as const, arrivalAt: new Date(NOW + arrivalInMs).toISOString() },
];

describe('transit poll interval (T1.5)', () => {
  it('idles when there is no active mission', () => {
    expect(transitPollInterval([], NOW)).toBe(POLL_IDLE_MS);
    expect(transitPollInterval(undefined, NOW)).toBe(POLL_IDLE_MS);
  });

  it('heartbeats slowly while the mission is far from arrival', () => {
    expect(transitPollInterval(inTransit(20 * 60_000), NOW)).toBe(POLL_FAR_MS);
    expect(transitPollInterval(inTransit(NEAR_ARRIVAL_MS + 1), NOW)).toBe(POLL_FAR_MS);
  });

  it('speeds up near arrival and once the arrival time has passed', () => {
    expect(transitPollInterval(inTransit(NEAR_ARRIVAL_MS), NOW)).toBe(POLL_NEAR_MS);
    expect(transitPollInterval(inTransit(-5_000), NOW)).toBe(POLL_NEAR_MS);
  });

  it('polls fast while the server resolves the mission, slowly for held/accepted ones', () => {
    expect(transitPollInterval([{ status: 'RESOLVING', arrivalAt: null }], NOW)).toBe(POLL_NEAR_MS);
    expect(transitPollInterval([{ status: 'HELD', arrivalAt: null }], NOW)).toBe(POLL_FAR_MS);
    expect(transitPollInterval([{ status: 'ACCEPTED', arrivalAt: null }], NOW)).toBe(POLL_FAR_MS);
  });

  it('keeps the request rate low across a whole 15-minute mission', () => {
    const arrival = 15 * 60_000;
    const missions = (t: number) => inTransit(arrival - t);
    const polls: number[] = [];
    let t = 0;
    while (t <= arrival + 60_000) {
      polls.push(t);
      t += transitPollInterval(missions(t), NOW);
    }
    // Any one-minute window before the final approach stays within the 4/min heartbeat...
    const busiest = (from: number, to: number) =>
      Math.max(
        ...polls
          .filter((p) => p >= from && p <= to)
          .map((p) => polls.filter((q) => q >= p && q < p + 60_000).length),
      );
    expect(busiest(0, arrival - 2 * 60_000)).toBeLessThanOrEqual(4);
    // ...and even the final approach never approaches the old 30/min.
    expect(busiest(0, arrival + 60_000)).toBeLessThanOrEqual(20);
    expect(polls.length).toBeLessThan(90); // the old fixed 2 s tick made 480 requests
  });
});
