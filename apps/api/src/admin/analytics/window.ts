import { BadRequestException } from '@nestjs/common';

// S11.3: every dashboard/economy/world aggregate answers for a time window. The query
// params are optional instants (ISO-8601); with no bounds the window is "the last 7 days
// ending now", so a dashboard never has to page through the whole event history.
export interface AnalyticsWindow {
  readonly from: Date;
  readonly to: Date;
}

export const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function parseInstant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be an ISO-8601 instant`);
  }
  return parsed;
}

export function parseWindow(from?: string, to?: string, now = new Date()): AnalyticsWindow {
  const end = to === undefined ? now : parseInstant(to, 'to');
  const start =
    from === undefined ? new Date(end.getTime() - DEFAULT_WINDOW_MS) : parseInstant(from, 'from');
  if (start.getTime() >= end.getTime()) {
    throw new BadRequestException('window requires from < to');
  }
  return { from: start, to: end };
}
