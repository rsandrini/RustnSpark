import type { RaceRoutesResponse, RankingResponse } from '../../api/generated';

const entries = [
  { rank: 1, name: 'Mira', factionId: 'sun', value: 9800, isMe: false },
  { rank: 2, name: 'Test Pilot', factionId: 'luna', value: 4200, isMe: true },
  { rank: 3, name: 'Oro', factionId: 'explorers', value: 1500, isMe: false },
];

export function rankingFixture(overrides: Partial<RankingResponse> = {}): RankingResponse {
  return {
    board: 'distance',
    window: 'lifetime',
    route: null,
    weekStart: null,
    entries,
    me: { rank: 2, value: 4200 },
    total: 3,
    ...overrides,
  };
}

export function raceRoutesFixture(): RaceRoutesResponse {
  return {
    routes: [
      { routeKey: 'ceres>hedus', originId: 'ceres', destinationId: 'hedus', pilots: 3 },
      { routeKey: 'ceres>vesta', originId: 'ceres', destinationId: 'vesta', pilots: 1 },
    ],
  };
}
