import { scaleSpeed } from '../../ui/display';
import type { DisplayResponse } from '../../api/generated';

/** A requirement figure as the player reads it: mobility on the display scale (like the ship sheet),
    combat as a percent, a needed cargo space rounded up to a whole unit (the minimum can be a
    fraction of the load, never shown as 0.25), everything else as it is. */
export function requirementNumber(
  value: number,
  unit: string | undefined,
  display: DisplayResponse,
  role: 'needed' | 'actual' = 'actual',
): string {
  if (unit === 'combat') return `${Math.round(value * 100)}%`;
  const shown =
    unit === 'mobility'
      ? scaleSpeed(value, display)
      : unit === 'cargo' && role === 'needed'
        ? Math.ceil(value)
        : value;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(shown);
}

/** The time line a mission card adds for the ship's specialty: trips when the load exceeds the
    hold, else how much slower or faster; null when the ship meets the need exactly. */
export function specialtyLine(
  specialty: { factor: number; trips: number | null } | null | undefined,
): { kind: 'trips'; count: number } | { kind: 'slower' | 'faster'; pct: number } | null {
  if (specialty === null || specialty === undefined || specialty.factor === 1) return null;
  if (specialty.trips !== null && specialty.trips > 1)
    return { kind: 'trips', count: specialty.trips };
  const pct = Math.round(Math.abs(specialty.factor - 1) * 100);
  if (pct === 0) return null;
  return { kind: specialty.factor > 1 ? 'slower' : 'faster', pct };
}
