import { Injectable } from '@nestjs/common';
import { localize } from '../common/i18n/localize.js';
import { BoardService } from '../missions/board.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Localized text as stored on world rows (Json columns seeded with both locales).
export interface LocalizedText {
  readonly en: string;
  readonly 'pt-BR': string;
}

function bilingual(value: unknown): LocalizedText {
  return { en: localize(value, 'en'), 'pt-BR': localize(value, 'pt-BR') };
}

export type RiskBand = 'lo' | 'md' | 'hi';

export interface WorldLocation {
  readonly id: string;
  readonly displayName: LocalizedText;
  readonly description: LocalizedText;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly zone: number;
  readonly factionId: string;
  readonly isolation: number;
  readonly services: Record<string, unknown>;
  readonly risk: RiskBand;
  readonly missionCount: number;
}

export interface WorldRoute {
  readonly id: string;
  readonly nodeAId: string;
  readonly nodeBId: string;
  readonly distance: number;
  readonly danger: number;
  /** Server-decided "hot" corridor (D24: the map highlights it); the client holds no threshold. */
  readonly hot: boolean;
}

export interface WorldResponse {
  readonly locations: WorldLocation[];
  readonly routes: WorldRoute[];
}

// D24: a hot edge is one whose danger reaches the node-risk `hi` value (2 lo / 5 md / 8 hi,
// +1 on hot edges), so 8 and above is the hot band.
const HOT_ROUTE_DANGER = 8;

// GDD §2: zone 0–1 is the safe core, 2 the belt, 3 the frontier edge. The band is
// computed here (not in the client) so "risk" stays server-owned like every rule.
function riskOfZone(zone: number): RiskBand {
  if (zone <= 1) return 'lo';
  if (zone === 2) return 'md';
  return 'hi';
}

@Injectable()
export class WorldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly board: BoardService,
  ) {}

  /**
   * The whole map in one read (S10.5): node geometry, routes with their danger, the
   * server-computed risk band and live mission counts. Counts run the same flip/top-up
   * as the board itself, so what the map shows is exactly what the board serves.
   */
  async getWorld(): Promise<WorldResponse> {
    const [locations, routes] = await Promise.all([
      this.prisma.location.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.route.findMany({ orderBy: { id: 'asc' } }),
    ]);
    const counts = await this.board.countOffers(locations.map((location) => location.id));

    return {
      locations: locations.map((location) => ({
        id: location.id,
        displayName: bilingual(location.displayName),
        description: bilingual(location.description),
        type: location.type,
        x: location.x,
        y: location.y,
        zone: location.zone,
        factionId: location.factionId,
        isolation: location.isolation,
        services: location.services as Record<string, unknown>,
        risk: riskOfZone(location.zone),
        missionCount: counts.get(location.id) ?? 0,
      })),
      routes: routes.map((route) => ({
        id: route.id,
        nodeAId: route.nodeAId,
        nodeBId: route.nodeBId,
        distance: route.distance,
        danger: route.danger,
        hot: route.danger >= HOT_ROUTE_DANGER,
      })),
    };
  }
}
