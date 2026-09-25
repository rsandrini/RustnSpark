import { client } from '../api/client';
import type * as dto from '../api/generated';

// Admin endpoints beyond the tuning bundle (which lives in the shared contract) are
// internal to the admin UI: their types mirror apps/api's S11.2–S11.4 responses and the
// API's own integration specs pin the shapes.

export interface AnalyticsResponse<T> {
  window: { from: string; to: string };
  data: T;
}

export interface DashboardData {
  players: { new: number; active: number };
  missions: {
    total: number;
    success: number;
    partialFailure: number;
    failed: number;
    adrift: number;
    successRate: number;
  };
  combat: { encounters: number; wins: number; losses: number; winrate: number; baseline: number };
  tiers: { tiers: Record<string, number>; ships: number };
}

export interface EconomyData {
  entering: number;
  leaving: number;
  net: number;
  sources: Array<{ reason: string; total: number }>;
  sinks: Array<{ reason: string; total: number }>;
}

export interface WorldData {
  traffic: Array<{ routeId: string; crossings: number }>;
  encounters: number;
  zones: Array<{ zone: string; generated: number; consumed: number }>;
}

export interface SystemFlag {
  key: string;
  value: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface LocalizedMessage {
  en: string;
  'pt-BR': string;
}

export interface SystemNotice {
  id: string;
  message: LocalizedMessage;
  active: boolean;
  createdBy: string;
  createdAt: string;
  dismissedAt: string | null;
}

export interface PlayerListItem {
  id: string;
  name: string;
  credits: number;
  factionId: string | null;
  accountEmail: string;
  accountStatus: string;
}

export interface PlayerSheet {
  account: {
    id: string;
    email: string;
    role: string;
    status: string;
    createdAt: string;
  };
  player: {
    id: string;
    name: string;
    credits: number;
    locale: string;
    factionId: string | null;
    createdAt: string;
  };
  ships: Array<{
    id: string;
    name: string;
    status: string;
    stance: string;
    fuel: number;
    currentLocationId: string | null;
  }>;
  materials: Array<{ materialId: string; quantity: number }>;
  activeMissions: Array<{
    id: string;
    type: string;
    status: string;
    originId: string;
    destinationId: string;
    acceptedAt: string | null;
  }>;
}

export interface TimelineEvent {
  id: string;
  at: string;
  type: string;
  creditsDelta: number | null;
  payload: unknown;
}

export interface TimelinePage {
  items: TimelineEvent[];
  nextCursor?: string;
}

export interface ReplayResponse {
  missionId: string;
  rulesHash: string;
  stored: { outcome: string; events: number };
  replay: { outcome: string; creditsDelta: number; events: unknown[] };
  matchesStored: boolean;
  report: dto.ReportResponse;
}

export interface SupportResult {
  action: string;
  target: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

const encode = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
};

export const adminApi = {
  // Screens A–C: the server defaults to the last 7 days when no window is given.
  dashboard: () => client.get<AnalyticsResponse<DashboardData>>('/v1/admin/analytics/dashboard'),
  economy: () => client.get<AnalyticsResponse<EconomyData>>('/v1/admin/analytics/economy'),
  world: () => client.get<AnalyticsResponse<WorldData>>('/v1/admin/analytics/world'),

  // Screen E: flags + broadcast.
  listFlags: () => client.get<SystemFlag[]>('/v1/admin/system/flags'),
  setFlag: (key: string, value: boolean) =>
    client.put<SystemFlag>(`/v1/admin/system/flags/${encodeURIComponent(key)}`, { value }),
  listNotices: () => client.get<SystemNotice[]>('/v1/admin/system/notices'),
  createNotice: (message: LocalizedMessage) =>
    client.post<SystemNotice>('/v1/admin/system/notices', { message }),
  dismissNotice: (id: string) =>
    client.post<SystemNotice>(`/v1/admin/system/notices/${id}/dismiss`),

  // Screen D: inspector reads.
  searchPlayers: (q?: string) =>
    client.get<{ items: PlayerListItem[] }>(`/v1/admin/players${encode({ q })}`),
  playerSheet: (playerId: string) => client.get<PlayerSheet>(`/v1/admin/players/${playerId}`),
  playerTimeline: (playerId: string, cursor?: string, limit?: number) =>
    client.get<TimelinePage>(`/v1/admin/players/${playerId}/events${encode({ cursor, limit })}`),
  playerReports: (playerId: string, cursor?: string) =>
    client.get<dto.ReportListResponse>(
      `/v1/admin/players/${playerId}/reports${encode({ cursor })}`,
    ),
  replayReport: (playerId: string, missionId: string, view?: string, locale?: string) =>
    client.get<ReplayResponse>(
      `/v1/admin/players/${playerId}/reports/${missionId}/replay${encode({ view, locale })}`,
    ),

  // Screen D: support actions. Every one carries the operator's reason — the API
  // rejects the request without it.
  grantCredits: (playerId: string, amount: number, reason: string) =>
    client.post<SupportResult>(`/v1/admin/players/${playerId}/credits/grant`, {
      amount,
      reason,
    }),
  removeCredits: (playerId: string, amount: number, reason: string) =>
    client.post<SupportResult>(`/v1/admin/players/${playerId}/credits/remove`, {
      amount,
      reason,
    }),
  clearBalance: (playerId: string, reason: string) =>
    client.post<SupportResult>(`/v1/admin/players/${playerId}/clear-balance`, { reason }),
  banPlayer: (playerId: string, reason: string) =>
    client.post<SupportResult>(`/v1/admin/players/${playerId}/ban`, { reason }),
  resetPlayer: (playerId: string, reason: string) =>
    client.post<SupportResult>(`/v1/admin/players/${playerId}/reset`, { reason }),
  unstickShip: (playerId: string, shipId: string, reason: string) =>
    client.post<SupportResult>(`/v1/admin/players/${playerId}/ships/${shipId}/unstick`, {
      reason,
    }),
};
