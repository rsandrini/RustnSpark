import { scaleSpeed } from '../../ui/display';
import type { DisplayResponse, MissionOffer } from '../../api/generated';

/** A requirement figure as the player reads it: mobility on the display scale (like the ship sheet),
    combat as a percent and radar strength as a plain number, both with one decimal (actual rounded down,
    needed up, so a ship just short never reads equal), a needed cargo space rounded up to a whole unit (the minimum can be a
    fraction of the load, never shown as 0.25), everything else as it is. */
export function requirementNumber(
  value: number,
  unit: string | undefined,
  display: DisplayResponse,
  role: 'needed' | 'actual' = 'actual',
): string {
  // whole tenths of `scaled`, rounded against the pilot (the epsilon absorbs float noise)
  const tenth = (scaled: number): number =>
    (role === 'needed' ? Math.ceil(scaled - 1e-9) : Math.floor(scaled + 1e-9)) / 10;
  if (unit === 'combat') {
    return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(tenth(value * 1000))}%`;
  }
  if (unit === 'sensor') {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(tenth(value * 10));
  }
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

/** The share of the asked area the radar covers, as a whole percent: rounded down, so a short scan never reads 100. */
export function coveredPercent(share: number): number {
  return Math.floor(share * 100 + 1e-9);
}

/** The scan figures a card may show: none for a radar that covers nothing, nor on an offer the pilot
    cannot take (the server still sends a plan then). A mission already taken has no such verdict. */
export function explorePlan(offer: MissionOffer, taken: boolean): MissionOffer['info']['explore'] {
  const plan = offer.info.explore;
  if (plan == null || plan.perTick <= 0) return null;
  return taken || offer.eligibility.eligible ? plan : null;
}
