import { client } from '../api/client';
import type {
  LocalizedText,
  ReportListResponse,
  AdminSystemNotice as SystemNotice,
  DashboardData,
  EconomyData,
  PlayerListItem,
  PlayerSheet,
  ReplayResponse,
  SupportResult,
  SystemFlag,
  TimelinePage,
  AdminWorldData as WorldData,
} from '../api/generated';

// Every admin response type comes from the shared contract (packages/contract); the API's
// integration specs parse the real responses with the same schemas.

export type {
  LocalizedText as LocalizedMessage,
  AdminSystemNotice as SystemNotice,
  DashboardData,
  EconomyData,
  PlayerListItem,
  PlayerSheet,
  ReplayResponse,
  SupportResult,
  SystemFlag,
  TimelineEvent,
  TimelinePage,
  AdminWorldData as WorldData,
} from '../api/generated';

export interface AnalyticsResponse<T> {
  window: { from: string; to: string };
  data: T;
}

/** Explicit ISO instants; omitted, the server answers for its own default (last 7 days). */
export interface AnalyticsRange {
  from?: string;
  to?: string;
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
  dashboard: (range?: AnalyticsRange) =>
    client.get<AnalyticsResponse<DashboardData>>(
      `/v1/admin/analytics/dashboard${encode({ ...range })}`,
    ),
  economy: (range?: AnalyticsRange) =>
    client.get<AnalyticsResponse<EconomyData>>(
      `/v1/admin/analytics/economy${encode({ ...range })}`,
    ),
  world: (range?: AnalyticsRange) =>
    client.get<AnalyticsResponse<WorldData>>(`/v1/admin/analytics/world${encode({ ...range })}`),

  // Screen E: flags + broadcast.
  listFlags: () => client.get<SystemFlag[]>('/v1/admin/system/flags'),
  setFlag: (key: string, value: boolean) =>
    client.put<SystemFlag>(`/v1/admin/system/flags/${encodeURIComponent(key)}`, { value }),
  listNotices: () => client.get<SystemNotice[]>('/v1/admin/system/notices'),
  createNotice: (message: LocalizedText) =>
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
    client.get<ReportListResponse>(`/v1/admin/players/${playerId}/reports${encode({ cursor })}`),
  replayReport: (playerId: string, missionId: string, view?: string, locale?: string) =>
    client.get<ReplayResponse>(
      `/v1/admin/players/${playerId}/reports/${missionId}/replay${encode({ view, locale })}`,
    ),

  // Screen D: support actions. Every one carries the operator's reason — the API
  // rejects the request without it.
  // Each action takes the Idempotency-Key of the operator's intent: a double click or a retry
  // after a lost response replays the first result instead of granting/banning twice.
  grantCredits: (playerId: string, amount: number, reason: string, key: string) =>
    client.post<SupportResult>(
      `/v1/admin/players/${playerId}/credits/grant`,
      { amount, reason },
      { idempotencyKey: key },
    ),
  removeCredits: (playerId: string, amount: number, reason: string, key: string) =>
    client.post<SupportResult>(
      `/v1/admin/players/${playerId}/credits/remove`,
      { amount, reason },
      { idempotencyKey: key },
    ),
  clearBalance: (playerId: string, reason: string, key: string) =>
    client.post<SupportResult>(
      `/v1/admin/players/${playerId}/clear-balance`,
      { reason },
      { idempotencyKey: key },
    ),
  banPlayer: (playerId: string, reason: string, key: string) =>
    client.post<SupportResult>(
      `/v1/admin/players/${playerId}/ban`,
      { reason },
      { idempotencyKey: key },
    ),
  resetPlayer: (playerId: string, reason: string, key: string) =>
    client.post<SupportResult>(
      `/v1/admin/players/${playerId}/reset`,
      { reason },
      { idempotencyKey: key },
    ),
  unstickShip: (playerId: string, shipId: string, reason: string, key: string) =>
    client.post<SupportResult>(
      `/v1/admin/players/${playerId}/ships/${shipId}/unstick`,
      { reason },
      { idempotencyKey: key },
    ),
};
