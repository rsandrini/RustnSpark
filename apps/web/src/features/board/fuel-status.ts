/** Where a trip stands on fuel: enough aboard, short but the tank can hold it (refuel), or more than the tank can ever hold. */
export type FuelState = 'ok' | 'short' | 'tank';

export interface FuelStatus {
  state: FuelState;
  have: number;
  needed: number;
  cap: number;
  /** How much more fuel the trip needs than is aboard (0 when enough). */
  missing: number;
  /** The scale of a bar showing all three: the biggest of the fuel aboard, the trip and the tank. */
  scale: number;
}

/**
 * The three-way fuel verdict of a trip: `ok` when the fuel aboard covers it, `short` when it does not but the tank could
 * hold it (refuelling fixes it), `tank` when the trip needs more than the tank holds (only a bigger tank or a shorter
 * route fixes it). Amounts are rounded to whole units, like the rest of the fuel on screen.
 */
export function fuelStatus(have: number, needed: number, cap: number): FuelStatus {
  const h = Math.round(have);
  const n = Math.round(needed);
  const c = Math.round(cap);
  const state: FuelState = n > c ? 'tank' : h >= n ? 'ok' : 'short';
  return {
    state,
    have: h,
    needed: n,
    cap: c,
    missing: Math.max(0, n - h),
    scale: Math.max(1, h, n, c),
  };
}
