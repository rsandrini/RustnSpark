import type { ShipClassType } from '../ships/ship-class.js';
import type { StatRecords, StatTotals } from './stat-keys.js';

// The shapes of the profile endpoints. The API does not depend on the contract package (the web
// app and the integration tests do): profile-stats.int-spec parses real responses with the
// contract's zod schemas, so a drift between these and the schemas fails there.

export interface MyStatsResponse {
  totals: StatTotals;
  records: StatRecords;
  firstMissionAt: string | null;
  lastActiveAt: string | null;
}

export interface PublicProfileShip {
  /** Placeholder callsign until ships have names. */
  title: string;
  shipClass: ShipClassType;
  /** Rarity of the installed bridge. */
  bridgeRarity: string;
}

export interface PublicProfileResponse {
  name: string;
  factionId: string | null;
  joinedAt: string;
  ship: PublicProfileShip | null;
  totals: StatTotals;
  records: StatRecords;
  /** success / (success + failed + aborted); null before the first finished mission. */
  successRate: number | null;
}
