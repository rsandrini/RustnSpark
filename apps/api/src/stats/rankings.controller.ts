import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { RankingsService } from './rankings.service.js';
import {
  RANKING_BOARDS,
  RANKING_WINDOWS,
  type RaceRoutesResponse,
  type RankingBoard,
  type RankingResponse,
  type RankingWindow,
} from './rankings.types.js';

const DEFAULT_WINDOW: RankingWindow = 'lifetime';

// No @Public(): the global JwtAuthGuard's default-deny applies. The boards are the same for every
// signed-in pilot (names are public on the card already); only the pinned own row depends on the caller.
@Controller('rankings')
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  // Declared before ':board' so 'race-routes' is never read as a board name.
  @Get('race-routes')
  raceRoutes(): Promise<RaceRoutesResponse> {
    return this.rankings.raceRoutes();
  }

  @Get(':board')
  board(
    @CurrentUser() user: CurrentUserPayload,
    @Param('board') board: string,
    @Query('window') window?: string,
    @Query('route') route?: string,
  ): Promise<RankingResponse> {
    if (!isBoard(board)) throw new BadRequestException({ error: 'INVALID_BOARD' });
    const chosen = window ?? DEFAULT_WINDOW;
    if (!isWindow(chosen)) throw new BadRequestException({ error: 'INVALID_WINDOW' });
    if (board === 'race_time' && (route === undefined || route === '')) {
      throw new BadRequestException({ error: 'ROUTE_REQUIRED' });
    }
    return this.rankings.board(user.playerId, board, chosen, route);
  }
}

function isBoard(value: string): value is RankingBoard {
  return (RANKING_BOARDS as readonly string[]).includes(value);
}

function isWindow(value: string): value is RankingWindow {
  return (RANKING_WINDOWS as readonly string[]).includes(value);
}
