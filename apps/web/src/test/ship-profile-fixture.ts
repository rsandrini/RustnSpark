import type { ShipProfile } from '../api/generated';

/** A ship with no main point: every axis low, so its type is Balanced. */
export const BALANCED_PROFILE: ShipProfile = {
  cargo: 0.2,
  passengers: 0,
  firepower: 0.1,
  defense: 0.1,
  mobility: 0.1,
  range: 0.1,
  mining: 0,
};
