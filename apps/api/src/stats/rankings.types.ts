export const RANKING_BOARDS = [
  'distance',
  'fights_won',
  'race_wins',
  'race_time',
  'ship_power',
  'ship_speed',
] as const;
export type RankingBoard = (typeof RANKING_BOARDS)[number];

/** Boards read from the ship snapshot: they have no weekly window, only the latest rating. */
export const SHIP_BOARDS: readonly RankingBoard[] = ['ship_power', 'ship_speed'];

export const RANKING_WINDOWS = ['weekly', 'lifetime'] as const;
export type RankingWindow = (typeof RANKING_WINDOWS)[number];

// The shapes of the ranking endpoints. The API does not import the contract package (see
// profile.types.ts); rankings-api.int-spec parses real responses with the contract's schemas.

export interface RankingEntry {
  rank: number;
  name: string;
  factionId: string | null;
  value: number;
  isMe: boolean;
}

export interface RankingResponse {
  board: RankingBoard;
  window: RankingWindow;
  /** The race route of a race-time board; null for the others. */
  route: string | null;
  /** Monday 00:00 Brazil time (UTC-3) of the weekly window; null for lifetime. */
  weekStart: string | null;
  entries: RankingEntry[];
  /** The pilot's own position, whether or not they are in `entries`; null with no result. */
  me: { rank: number; value: number } | null;
  /** Everyone ranked on this board. */
  total: number;
}

export interface RaceRoute {
  routeKey: string;
  originId: string;
  destinationId: string;
  pilots: number;
}

export interface RaceRoutesResponse {
  routes: RaceRoute[];
}
